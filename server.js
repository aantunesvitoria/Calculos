require("dotenv").config();

const express = require("express");
const crypto = require("crypto");
const fs = require("fs/promises");
const PDFDocument = require("pdfkit");
const path = require("path");

const app = express();
const port = Number(process.env.PORT || 3000);
const reportsDir = path.join(__dirname, "reports");
const adminSessions = new Map();

app.use(express.json({ limit: "120kb" }));
app.use(express.urlencoded({ extended: false }));
app.use((req, res, next) => {
  const allowedOrigins = new Set([
    "https://aantunesvitoria.github.io",
    "http://localhost:3000",
    "http://127.0.0.1:3000"
  ]);
  const origin = req.headers.origin;

  if (allowedOrigins.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }

  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }

  return next();
});
app.use(express.static(path.join(__dirname, "public")));

app.get("/healthz", (req, res) => {
  res.json({ ok: true });
});

function asNumber(value) {
  const parsed = Number(String(value || "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(value) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL"
  }).format(value);
}

function areaLabel(area) {
  if (area <= 35) return "compacto";
  if (area <= 80) return "médio";
  if (area <= 140) return "amplo";
  return "grande";
}

function sanitizeFilename(value) {
  return String(value || "cliente")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

function fieldLabel(value) {
  const labels = {
    apartamento: "Apartamento",
    casa: "Casa",
    comercial: "Comercial",
    outro: "Outro",
    vazio: "Vazio",
    morando: "Morando no local",
    obra: "Em obra",
    compra: "Em compra/entrega",
    consultoria: "Consultoria",
    decoracao: "Decoração",
    reforma: "Reforma",
    obra_completa: "Obra completa",
    minimalista: "Minimalista",
    contemporaneo: "Contemporâneo",
    classico: "Clássico",
    industrial: "Industrial",
    escandinavo: "Escandinavo",
    personalizado: "Personalizado",
    funcionalidade: "Funcionalidade",
    estetica: "Estética",
    prazo: "Prazo",
    economia: "Economia",
    valorizacao: "Valorização do imóvel"
  };

  return labels[value] || value || "não informado";
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatDateTime(value) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short"
  }).format(value);
}

function reportDisplayName(filename) {
  const cleaned = String(filename || "")
    .replace(/^pre-briefing-/, "")
    .replace(/-\d{4}-\d{2}-\d{2}t.*/i, "")
    .replace(/\.pdf$/i, "")
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

  return cleaned || "Relatório de briefing";
}

function calculateReport(data) {
  const area = asNumber(data.area);
  const rooms = Math.max(1, asNumber(data.rooms));
  const budget = asNumber(data.budget);
  const deadlineDays = asNumber(data.deadlineDays);

  const scopeWeights = {
    consultoria: 70,
    decoracao: 120,
    reforma: 230,
    obra_completa: 360
  };

  const styleComplexity = {
    minimalista: 0.9,
    contemporaneo: 1,
    classico: 1.2,
    industrial: 1.05,
    escandinavo: 1,
    personalizado: 1.25
  };

  const scopeRate = scopeWeights[data.scope] || scopeWeights.decoracao;
  const styleRate = styleComplexity[data.style] || 1;
  const roomMultiplier = 1 + Math.min(rooms - 1, 8) * 0.08;
  const estimatedService = area * scopeRate * styleRate * roomMultiplier;
  const estimatedExecution = data.scope === "consultoria" ? 0 : area * 900 * styleRate;
  const estimatedTotal = estimatedService + estimatedExecution;

  const budgetGap = budget > 0 ? budget - estimatedTotal : 0;
  const urgency =
    deadlineDays > 0 && deadlineDays < 30
      ? "alta"
      : deadlineDays <= 75
        ? "moderada"
        : "confortavel";

  const notes = [];

  if (budget <= 0) {
    notes.push("Cliente ainda não informou verba objetiva.");
  } else if (budgetGap >= 0) {
    notes.push(`Verba informada cobre a estimativa inicial com folga de ${money(budgetGap)}.`);
  } else {
    notes.push(`Verba informada fica abaixo da estimativa inicial em ${money(Math.abs(budgetGap))}.`);
  }

  if (urgency === "alta") {
    notes.push("Prazo apertado: sugerir escopo faseado e decisões rápidas de materiais.");
  }

  if (data.propertyStatus === "morando") {
    notes.push("Cliente mora no local: considerar cronograma por etapas e menor interferência na rotina.");
  }

  return {
    area,
    rooms,
    estimatedService,
    estimatedExecution,
    estimatedTotal,
    urgency,
    notes,
    profile: `Projeto ${areaLabel(area)} com prioridade em ${fieldLabel(data.priority)}.`
  };
}

function getAdminPassword() {
  return process.env.ADMIN_PASSWORD || "admin123";
}

function parseCookies(req) {
  return Object.fromEntries(
    String(req.headers.cookie || "")
      .split(";")
      .map((cookie) => cookie.trim())
      .filter(Boolean)
      .map((cookie) => {
        const index = cookie.indexOf("=");
        return [cookie.slice(0, index), decodeURIComponent(cookie.slice(index + 1))];
      })
  );
}

function isAdminAuthorized(req) {
  const cookies = parseCookies(req);
  const session = cookies.admin_session;
  const expiresAt = adminSessions.get(session);

  if (!session || !expiresAt) return false;

  if (Date.now() > expiresAt) {
    adminSessions.delete(session);
    return false;
  }

  return true;
}

function setAdminSession(res) {
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = Date.now() + 1000 * 60 * 60 * 8;

  adminSessions.set(token, expiresAt);
  res.setHeader(
    "Set-Cookie",
    `admin_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${60 * 60 * 8}`
  );
}

function clearAdminSession(req, res) {
  const cookies = parseCookies(req);
  if (cookies.admin_session) {
    adminSessions.delete(cookies.admin_session);
  }
  res.setHeader("Set-Cookie", "admin_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
}

function adminLoginPage(errorMessage = "") {
  return `
    <!doctype html>
    <html lang="pt-BR">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>Acesso privado</title>
        <style>
          :root { --ink: #20211f; --muted: #66706a; --line: #d9ddd6; --paper: #f6f3ec; --accent: #47685c; --accent-strong: #2f4f45; --clay: #b47058; --gold: #c79b42; }
          * { box-sizing: border-box; }
          body {
            margin: 0;
            min-height: 100vh;
            display: grid;
            place-items: center;
            padding: 28px 16px;
            background:
              linear-gradient(120deg, rgba(47, 79, 69, 0.88), rgba(32, 33, 31, 0.68)),
              url("https://images.unsplash.com/photo-1600210491369-e753d80a41f3?auto=format&fit=crop&w=1600&q=82") center / cover;
            color: var(--ink);
            font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          }
          .login-shell {
            width: min(920px, 100%);
            display: grid;
            grid-template-columns: minmax(0, 0.9fr) minmax(360px, 0.62fr);
            border: 1px solid rgba(255, 255, 255, 0.28);
            border-radius: 8px;
            overflow: hidden;
            background: rgba(255, 255, 255, 0.88);
            box-shadow: 0 28px 90px rgba(0, 0, 0, 0.28);
            backdrop-filter: blur(18px);
          }
          .login-copy {
            min-height: 520px;
            display: grid;
            align-content: end;
            padding: clamp(28px, 5vw, 54px);
            color: #fff;
            background:
              linear-gradient(180deg, rgba(32, 33, 31, 0.12), rgba(32, 33, 31, 0.74)),
              url("https://images.unsplash.com/photo-1618220179428-22790b461013?auto=format&fit=crop&w=1200&q=82") center / cover;
          }
          .eyebrow { margin: 0 0 10px; color: var(--gold); font-size: 0.76rem; font-weight: 900; text-transform: uppercase; }
          h1 { margin: 0; font-size: clamp(2.15rem, 5vw, 4.2rem); line-height: 1.02; letter-spacing: 0; }
          .login-copy p { max-width: 420px; margin: 18px 0 0; color: rgba(255, 255, 255, 0.86); }
          form { display: grid; align-content: center; padding: clamp(24px, 4vw, 42px); background: #fff; }
          form h2 { margin: 0; font-size: clamp(1.55rem, 3vw, 2.15rem); line-height: 1.08; letter-spacing: 0; }
          form > p { margin: 10px 0 22px; color: var(--muted); }
          .error { margin: 0 0 18px; border-left: 4px solid #a33a2d; padding: 10px 12px; border-radius: 6px; background: #fff1ee; color: #8d2f24; font-weight: 800; }
          label { display: grid; gap: 8px; margin-top: 14px; font-size: 0.94rem; font-weight: 800; }
          input { min-height: 48px; border: 1px solid var(--line); border-radius: 6px; padding: 0 12px; background: #fbfbf8; color: var(--ink); font: inherit; }
          input:focus { outline: 0; border-color: var(--gold); box-shadow: 0 0 0 4px rgba(199, 155, 66, 0.18); background: #fff; }
          button { width: 100%; min-height: 48px; margin-top: 20px; border: 0; border-radius: 999px; background: var(--accent); color: #fff; font: inherit; font-weight: 900; cursor: pointer; box-shadow: 0 14px 28px rgba(47, 79, 69, 0.25); }
          button:hover { background: var(--accent-strong); }
          a { display: inline-block; width: fit-content; margin-top: 18px; color: var(--accent-strong); font-weight: 900; text-decoration: none; }
          @media (max-width: 820px) {
            body { display: block; padding: 0; background: var(--paper); }
            .login-shell { min-height: 100vh; grid-template-columns: 1fr; border: 0; border-radius: 0; box-shadow: none; }
            .login-copy { min-height: 330px; }
            form { min-height: auto; padding: 24px 18px 34px; }
          }
        </style>
      </head>
      <body>
        <main class="login-shell">
          <section class="login-copy" aria-label="Acesso privado">
            <p class="eyebrow">Acesso privado</p>
            <h1>Relatórios de briefing</h1>
            <p>Consulte os PDFs gerados pelo formulário e baixe cada relatório para análise interna.</p>
          </section>
          <form method="post" action="/admin/login">
            <h2>Entrar na área privada</h2>
            <p>Use suas credenciais administrativas para acessar os relatórios.</p>
            ${errorMessage ? `<p class="error">${escapeHtml(errorMessage)}</p>` : ""}
            <label>
              Login
              <input name="username" type="text" autocomplete="username" autofocus>
            </label>
            <label>
              Senha
              <input name="password" type="password" autocomplete="current-password">
            </label>
            <button type="submit">Entrar</button>
            <a href="/">Voltar para o site</a>
          </form>
        </main>
      </body>
    </html>
  `;
}

function buildWhatsAppMessage(data, report, localFile) {
  const lines = [
    "*Novo pré-briefing recebido*",
    "",
    "*Cliente*",
    `Nome: ${data.name}`,
    `WhatsApp: ${data.phone}`,
    `E-mail: ${data.email || "não informado"}`,
    "",
    "*Projeto*",
    `Cidade/bairro: ${data.location || "não informado"}`,
    `Tipo de imóvel: ${fieldLabel(data.propertyType)}`,
    `Situação: ${fieldLabel(data.propertyStatus)}`,
    `Escopo: ${fieldLabel(data.scope)}`,
    `Estilo: ${fieldLabel(data.style)}`,
    `Área aproximada: ${report.area || "não informada"} m²`,
    `Ambientes: ${report.rooms}`,
    `Prazo desejado: ${data.deadlineDays || "não informado"} dias`,
    `Verba informada: ${data.budget ? money(asNumber(data.budget)) : "não informada"}`,
    "",
    "*Cálculos internos*",
    `Estimativa de serviço: ${money(report.estimatedService)}`,
    `Estimativa de execução/obra/decor: ${money(report.estimatedExecution)}`,
    `Estimativa total inicial: ${money(report.estimatedTotal)}`,
    `Urgência: ${report.urgency}`,
    `Perfil: ${report.profile}`,
    "",
    "*Feedback interno*",
    ...report.notes.map((note) => `- ${note}`),
    "",
    "*PDF salvo no servidor*",
    localFile?.filename || "não salvo",
    "",
    "*Desejos e observações do cliente*",
    data.description || "não informado"
  ];

  return lines.join("\n");
}

function ensurePdfSpace(doc, height = 120) {
  if (doc.y + height > doc.page.height - doc.page.margins.bottom) {
    doc.addPage();
  }
}

function drawPdfHeader(doc, data) {
  doc.rect(0, 0, doc.page.width, 142).fill("#2f4f45");
  doc.rect(0, 118, doc.page.width, 24).fill("#c79b42");

  doc
    .fillColor("#ffffff")
    .font("Helvetica-Bold")
    .fontSize(23)
    .text("Relatório de pré-briefing", 48, 40, { width: 340 });

  doc
    .font("Helvetica")
    .fontSize(9)
    .fillColor("#dce6df")
    .text("Interiores, obras, reformas e decoração", 48, 70);

  doc
    .font("Helvetica-Bold")
    .fontSize(11)
    .fillColor("#ffffff")
    .text(data.name || "Cliente não informado", 390, 44, { width: 150, align: "right" });

  doc
    .font("Helvetica")
    .fontSize(8.5)
    .fillColor("#dce6df")
    .text(new Date().toLocaleString("pt-BR"), 390, 64, { width: 150, align: "right" });

  doc.y = 170;
}

function drawMetricCard(doc, x, y, width, label, value) {
  doc.roundedRect(x, y, width, 58, 6).fill("#f6f3ec").stroke("#d9ddd6");
  doc.font("Helvetica").fontSize(8).fillColor("#66706a").text(label, x + 12, y + 12, { width: width - 24 });
  doc.font("Helvetica-Bold").fontSize(12).fillColor("#20211f").text(value, x + 12, y + 30, { width: width - 24 });
}

function addPdfMetrics(doc, report) {
  ensurePdfSpace(doc, 88);
  const y = doc.y;
  const width = 154;
  const gap = 14;

  drawMetricCard(doc, 48, y, width, "Serviço estimado", money(report.estimatedService));
  drawMetricCard(doc, 48 + width + gap, y, width, "Execução estimada", money(report.estimatedExecution));
  drawMetricCard(doc, 48 + (width + gap) * 2, y, width, "Total inicial", money(report.estimatedTotal));

  doc.y = y + 76;
}

function addSection(doc, title, rows) {
  ensurePdfSpace(doc, 92);

  const x = 48;
  const width = doc.page.width - 96;
  const startY = doc.y;

  doc.font("Helvetica-Bold").fontSize(13).fillColor("#2f4f45").text(title, x, startY);
  doc.moveDown(0.5);

  rows.forEach(([label, value]) => {
    ensurePdfSpace(doc, 30);
    doc.font("Helvetica-Bold").fontSize(9.5).fillColor("#20211f").text(`${label}: `, {
      continued: true
    });
    doc.font("Helvetica").fontSize(9.5).fillColor("#3d4240").text(String(value || "não informado"), {
      width: width - 20
    });
    doc.moveDown(0.28);
  });

  const endY = doc.y + 10;
  doc
    .roundedRect(x - 10, startY - 10, width + 20, Math.max(58, endY - startY + 10), 6)
    .lineWidth(0.7)
    .stroke("#d9ddd6");
  doc.y = endY + 8;
}

function addPdfNotes(doc, notes) {
  ensurePdfSpace(doc, 90);
  const startY = doc.y;
  const x = 48;
  const width = doc.page.width - 96;

  doc.font("Helvetica-Bold").fontSize(13).fillColor("#2f4f45").text("Feedback interno", x, startY);
  doc.moveDown(0.5);

  notes.forEach((note) => {
    ensurePdfSpace(doc, 26);
    doc.font("Helvetica").fontSize(9.5).fillColor("#3d4240").text(`- ${note}`, {
      width: width - 20
    });
    doc.moveDown(0.2);
  });

  const endY = doc.y + 10;
  doc.roundedRect(x - 10, startY - 10, width + 20, Math.max(58, endY - startY + 10), 6).stroke("#d9ddd6");
  doc.y = endY + 8;
}

function addPdfFooter(doc) {
  const bottom = doc.page.height - 34;
  doc
    .moveTo(48, bottom - 8)
    .lineTo(doc.page.width - 48, bottom - 8)
    .lineWidth(0.6)
    .stroke("#d9ddd6");
  doc.font("Helvetica").fontSize(8).fillColor("#66706a").text("Documento interno gerado automaticamente pelo pré-briefing.", 48, bottom, {
    width: doc.page.width - 96,
    align: "center"
  });
}

function generateReportPdf(data, report) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: 48,
      info: {
        Title: `Pré-briefing - ${data.name}`,
        Author: "Pré-briefing Interiores"
      }
    });

    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    drawPdfHeader(doc, data);
    addPdfMetrics(doc, report);

    addSection(doc, "Cliente", [
      ["Nome", data.name],
      ["WhatsApp", data.phone],
      ["E-mail", data.email || "não informado"]
    ]);

    addSection(doc, "Projeto", [
      ["Cidade/bairro", data.location || "não informado"],
      ["Tipo de imóvel", fieldLabel(data.propertyType)],
      ["Situação", fieldLabel(data.propertyStatus)],
      ["Escopo", fieldLabel(data.scope)],
      ["Estilo", fieldLabel(data.style)],
      ["Área aproximada", `${report.area || "não informada"} m²`],
      ["Ambientes", report.rooms],
      ["Prazo desejado", data.deadlineDays ? `${data.deadlineDays} dias` : "não informado"],
      ["Verba informada", data.budget ? money(asNumber(data.budget)) : "não informada"],
      ["Prioridade", fieldLabel(data.priority)]
    ]);

    addSection(doc, "Análise financeira", [
      ["Estimativa de serviço", money(report.estimatedService)],
      ["Estimativa de execução/obra/decor", money(report.estimatedExecution)],
      ["Estimativa total inicial", money(report.estimatedTotal)],
      ["Urgência", report.urgency],
      ["Perfil", report.profile]
    ]);

    addPdfNotes(doc, report.notes);

    addSection(doc, "Desejos e observações do cliente", [
      ["Descrição", data.description || "não informado"]
    ]);

    addPdfFooter(doc);
    doc.end();
  });
}

async function uploadPdfToGoogleDrive(data, report) {
  const dryRun = process.env.GOOGLE_DRIVE_DRY_RUN !== "false";
  const scriptUrl = process.env.GOOGLE_APPS_SCRIPT_URL;
  const filename = `pre-briefing-${sanitizeFilename(data.name)}-${Date.now()}.pdf`;

  if (dryRun || !scriptUrl) {
    console.log(`\n--- GOOGLE DRIVE DRY RUN ---\nPDF não enviado. Arquivo previsto: ${filename}\n----------------------------\n`);
    return { dryRun: true, filename };
  }

  const pdf = await generateReportPdf(data, report);
  const response = await fetch(scriptUrl, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain;charset=utf-8"
    },
    body: JSON.stringify({
      secret: process.env.GOOGLE_DRIVE_UPLOAD_SECRET,
      filename,
      mimeType: "application/pdf",
      content: pdf.toString("base64")
    })
  });

  const text = await response.text();
  let result;

  try {
    result = JSON.parse(text);
  } catch {
    throw new Error(`Resposta inválida do Google Apps Script: ${text}`);
  }

  if (!response.ok || !result.ok) {
    throw new Error(result.message || "Falha ao salvar PDF no Google Drive.");
  }

  return {
    filename,
    id: result.id,
    url: result.url
  };
}

async function saveReportPdf(data, report) {
  await fs.mkdir(reportsDir, { recursive: true });

  const createdAt = new Date();
  const filename = `pre-briefing-${sanitizeFilename(data.name)}-${createdAt.toISOString().replace(/[:.]/g, "-")}.pdf`;
  const filePath = path.join(reportsDir, filename);
  const pdf = await generateReportPdf(data, report);

  await fs.writeFile(filePath, pdf);

  return {
    filename,
    path: filePath,
    createdAt: createdAt.toISOString()
  };
}

async function sendWhatsAppMessage(message) {
  const dryRun = process.env.WHATSAPP_DRY_RUN !== "false";

  if (dryRun) {
    console.log("\n--- WHATSAPP DRY RUN ---\n" + message + "\n------------------------\n");
    return { dryRun: true };
  }

  const token = process.env.WHATSAPP_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const to = process.env.WHATSAPP_TO;

  if (!token || !phoneNumberId || !to) {
    throw new Error("Configuração do WhatsApp incompleta.");
  }

  const response = await fetch(`https://graph.facebook.com/v20.0/${phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: {
        preview_url: false,
        body: message
      }
    })
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Falha no envio do WhatsApp: ${details}`);
  }

  return response.json();
}

function validate(data) {
  const required = ["name", "phone", "scope", "propertyType", "propertyStatus", "area", "rooms"];
  const missing = required.filter((field) => !String(data[field] || "").trim());
  return missing;
}

app.post("/api/briefing", async (req, res) => {
  try {
    const data = req.body || {};
    const missing = validate(data);

    if (missing.length) {
      return res.status(400).json({
        ok: false,
        message: "Preencha os campos obrigatórios."
      });
    }

    const report = calculateReport(data);
    const localFile = await saveReportPdf(data, report);
    const message = buildWhatsAppMessage(data, report, localFile);
    await sendWhatsAppMessage(message);

    return res.json({
      ok: true,
      message: "Briefing enviado com sucesso."
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      ok: false,
      message: "Não foi possível enviar agora. Tente novamente em instantes."
    });
  }
});

app.get("/admin", async (req, res) => {
  if (!isAdminAuthorized(req)) {
    return res.type("html").send(adminLoginPage());
  }

  await fs.mkdir(reportsDir, { recursive: true });
  const files = await fs.readdir(reportsDir);
  const reports = await Promise.all(
    files
      .filter((file) => file.toLowerCase().endsWith(".pdf"))
      .map(async (file) => {
        const stat = await fs.stat(path.join(reportsDir, file));
        return {
          name: file,
          createdAt: stat.birthtime,
          size: stat.size
        };
      })
  );

  reports.sort((a, b) => b.createdAt - a.createdAt);

  const rows = reports.length
    ? reports
        .map((report) => `
          <tr>
            <td data-label="Arquivo">
              <span class="report-title">${escapeHtml(reportDisplayName(report.name))}</span>
              <span class="filename">${escapeHtml(report.name)}</span>
            </td>
            <td data-label="Data">${formatDateTime(report.createdAt)}</td>
            <td data-label="Tamanho">${Math.max(1, Math.round(report.size / 1024))} KB</td>
            <td data-label="Ação"><a class="download-link" href="/admin/reports/${encodeURIComponent(report.name)}">Baixar PDF</a></td>
          </tr>
        `)
        .join("")
    : `<tr><td colspan="4"><span class="empty-state">Nenhum relatório gerado ainda.</span></td></tr>`;

  const totalSizeKb = reports.reduce((total, report) => total + Math.max(1, Math.round(report.size / 1024)), 0);
  const latestReport = reports[0]?.createdAt ? formatDateTime(reports[0].createdAt) : "Ainda não há relatórios";

  return res.type("html").send(`
    <!doctype html>
    <html lang="pt-BR">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>Relatórios internos</title>
        <style>
          :root { --ink: #20211f; --muted: #66706a; --line: #d9ddd6; --paper: #f6f3ec; --panel: #fff; --accent: #47685c; --accent-strong: #2f4f45; --clay: #b47058; --gold: #c79b42; }
          * { box-sizing: border-box; }
          body {
            margin: 0;
            min-height: 100vh;
            background:
              linear-gradient(180deg, rgba(47, 79, 69, 0.12), rgba(246, 243, 236, 0) 330px),
              var(--paper);
            color: var(--ink);
            font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          }
          main { width: min(1120px, calc(100% - 32px)); margin: 0 auto; padding: 36px 0 58px; }
          .topbar {
            display: flex;
            align-items: start;
            justify-content: space-between;
            gap: 18px;
            margin-bottom: 24px;
          }
          .eyebrow { margin: 0 0 8px; color: var(--clay); font-size: 0.76rem; font-weight: 900; text-transform: uppercase; }
          h1 { margin: 0; font-size: clamp(2.1rem, 5vw, 4rem); letter-spacing: 0; line-height: 1.02; }
          p { margin: 12px 0 0; color: var(--muted); }
          .logout {
            min-height: 42px;
            border: 0;
            border-radius: 999px;
            padding: 0 20px;
            background: var(--ink);
            color: #fff;
            font: inherit;
            font-weight: 900;
            cursor: pointer;
          }
          .summary-grid {
            display: grid;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 14px;
            margin: 0 0 20px;
          }
          .summary-card {
            min-height: 112px;
            display: grid;
            align-content: center;
            gap: 8px;
            border: 1px solid rgba(217, 221, 214, 0.92);
            border-radius: 8px;
            padding: 18px;
            background: rgba(255, 255, 255, 0.88);
            box-shadow: 0 16px 45px rgba(34, 32, 28, 0.08);
          }
          .summary-card span { color: var(--muted); font-size: 0.82rem; font-weight: 800; text-transform: uppercase; }
          .summary-card strong { font-size: clamp(1.28rem, 3vw, 2rem); line-height: 1.05; }
          .table-shell {
            overflow: hidden;
            border: 1px solid rgba(217, 221, 214, 0.9);
            border-radius: 8px;
            background: var(--panel);
            box-shadow: 0 22px 70px rgba(34, 32, 28, 0.10);
          }
          table { width: 100%; border-collapse: collapse; }
          th, td { padding: 16px; border-bottom: 1px solid var(--line); text-align: left; font-size: 0.94rem; vertical-align: middle; }
          th { background: var(--accent-strong); color: #fff; font-size: 0.78rem; letter-spacing: 0; text-transform: uppercase; }
          tr:last-child td { border-bottom: 0; }
          .report-title { display: block; font-weight: 900; }
          .filename { display: block; max-width: 520px; margin-top: 3px; color: var(--muted); font-size: 0.82rem; overflow-wrap: anywhere; }
          .download-link {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            min-height: 38px;
            border-radius: 999px;
            padding: 0 16px;
            background: var(--accent);
            color: #fff;
            font-weight: 900;
            text-decoration: none;
            white-space: nowrap;
          }
          .download-link:hover { background: var(--accent-strong); }
          .empty-state { display: block; padding: 20px 0; color: var(--muted); text-align: center; }
          @media (max-width: 720px) {
            main { width: min(100% - 24px, 1120px); padding-top: 26px; }
            .topbar { display: grid; }
            .logout { width: 100%; }
            .summary-grid { grid-template-columns: 1fr; }
            .table-shell { border: 0; background: transparent; box-shadow: none; }
            table, thead, tbody, tr, th, td { display: block; }
            thead { display: none; }
            tbody { display: grid; gap: 12px; }
            tr {
              border: 1px solid var(--line);
              border-radius: 8px;
              padding: 14px;
              background: var(--panel);
              box-shadow: 0 14px 38px rgba(34, 32, 28, 0.08);
            }
            td {
              display: grid;
              grid-template-columns: 88px minmax(0, 1fr);
              gap: 10px;
              border: 0;
              padding: 8px 0;
              overflow-wrap: anywhere;
            }
            td::before { content: attr(data-label); color: var(--muted); font-size: 0.78rem; font-weight: 900; text-transform: uppercase; }
            td:last-child { grid-template-columns: 1fr; }
            td:last-child::before { display: none; }
            td[data-label="Arquivo"] { grid-template-columns: 1fr; }
            .download-link { width: 100%; }
          }
        </style>
      </head>
      <body>
        <main>
          <div class="topbar">
            <div>
              <p class="eyebrow">Acesso privado</p>
              <h1>Relatórios internos</h1>
              <p>PDFs gerados automaticamente quando o cliente envia o pré-briefing.</p>
            </div>
            <form method="post" action="/admin/logout">
              <button class="logout" type="submit">Sair</button>
            </form>
          </div>
          <section class="summary-grid" aria-label="Resumo dos relatórios">
            <div class="summary-card">
              <span>Total de PDFs</span>
              <strong>${reports.length}</strong>
            </div>
            <div class="summary-card">
              <span>Último briefing</span>
              <strong>${escapeHtml(latestReport)}</strong>
            </div>
            <div class="summary-card">
              <span>Armazenamento local</span>
              <strong>${totalSizeKb} KB</strong>
            </div>
          </section>
          <section class="table-shell" aria-label="Lista de relatórios">
            <table>
              <thead>
                <tr>
                  <th>Arquivo</th>
                  <th>Data</th>
                  <th>Tamanho</th>
                  <th>Ação</th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>
          </section>
        </main>
      </body>
    </html>
  `);
});

app.post("/admin/login", (req, res) => {
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "");

  if (username === "admin" && password === getAdminPassword()) {
    setAdminSession(res);
    return res.redirect("/admin");
  }

  return res.status(401).type("html").send(adminLoginPage("Login ou senha inválidos."));
});

app.post("/admin/logout", (req, res) => {
  clearAdminSession(req, res);
  return res.redirect("/admin");
});

app.get("/admin/reports/:filename", async (req, res) => {
  if (!isAdminAuthorized(req)) {
    return res.status(401).send("Acesso não autorizado.");
  }

  const filename = path.basename(req.params.filename);
  const filePath = path.join(reportsDir, filename);

  return res.download(filePath);
});

app.listen(port, () => {
  console.log(`Pré-briefing rodando em http://localhost:${port}`);
  console.log(`Relatórios internos em http://localhost:${port}/admin`);
});
