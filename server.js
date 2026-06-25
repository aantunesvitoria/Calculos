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
    profile: `Projeto ${areaLabel(area)} com prioridade em ${data.priority || "não informada"}.`
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
        <title>Acesso interno</title>
        <style>
          body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f6f3ec; color: #20211f; font-family: Arial, sans-serif; }
          form { width: min(420px, calc(100% - 32px)); padding: 28px; border-radius: 8px; background: #fff; box-shadow: 0 22px 70px rgba(34, 32, 28, 0.14); }
          h1 { margin: 0 0 8px; font-size: 1.7rem; }
          p { margin: 0 0 20px; color: #66706a; }
          .error { color: #a33a2d; font-weight: 700; }
          label { display: grid; gap: 8px; margin-top: 14px; font-weight: 700; }
          input { min-height: 46px; border: 1px solid #d9ddd6; border-radius: 6px; padding: 0 12px; font: inherit; }
          button { width: 100%; min-height: 46px; margin-top: 18px; border: 0; border-radius: 999px; background: #47685c; color: #fff; font: inherit; font-weight: 800; cursor: pointer; }
          a { display: inline-block; margin-top: 18px; color: #2f4f45; font-weight: 800; }
        </style>
      </head>
      <body>
        <form method="post" action="/admin/login">
          <h1>Área administrativa</h1>
          <p>Acesse os relatórios em PDF gerados pelos briefings.</p>
          ${errorMessage ? `<p class="error">${errorMessage}</p>` : ""}
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

function addSection(doc, title, rows) {
  doc.moveDown(0.8);
  doc.font("Helvetica-Bold").fontSize(13).fillColor("#2f4f45").text(title);
  doc.moveDown(0.35);

  rows.forEach(([label, value]) => {
    doc.font("Helvetica-Bold").fontSize(10).fillColor("#20211f").text(`${label}: `, {
      continued: true
    });
    doc.font("Helvetica").fontSize(10).fillColor("#3d4240").text(String(value || "não informado"));
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

    doc.rect(0, 0, doc.page.width, 120).fill("#2f4f45");
    doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(22).text("Relatório de pré-briefing", 48, 42);
    doc.font("Helvetica").fontSize(10).text(new Date().toLocaleString("pt-BR"), 48, 72);
    doc.moveDown(4);

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

    addSection(doc, "Cálculos internos", [
      ["Estimativa de serviço", money(report.estimatedService)],
      ["Estimativa de execução/obra/decor", money(report.estimatedExecution)],
      ["Estimativa total inicial", money(report.estimatedTotal)],
      ["Urgência", report.urgency],
      ["Perfil", report.profile]
    ]);

    doc.moveDown(0.8);
    doc.font("Helvetica-Bold").fontSize(13).fillColor("#2f4f45").text("Feedback interno");
    doc.moveDown(0.35);
    report.notes.forEach((note) => {
      doc.font("Helvetica").fontSize(10).fillColor("#3d4240").text(`• ${note}`);
    });

    addSection(doc, "Desejos e observações do cliente", [
      ["Descrição", data.description || "não informado"]
    ]);

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
            <td>${report.name}</td>
            <td>${report.createdAt.toLocaleString("pt-BR")}</td>
            <td>${Math.max(1, Math.round(report.size / 1024))} KB</td>
            <td><a href="/admin/reports/${encodeURIComponent(report.name)}">Baixar PDF</a></td>
          </tr>
        `)
        .join("")
    : `<tr><td colspan="4">Nenhum relatório gerado ainda.</td></tr>`;

  return res.type("html").send(`
    <!doctype html>
    <html lang="pt-BR">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>Relatórios internos</title>
        <style>
          body { margin: 0; background: #f6f3ec; color: #20211f; font-family: Arial, sans-serif; }
          main { width: min(1120px, calc(100% - 32px)); margin: 0 auto; padding: 42px 0; }
          h1 { margin: 0 0 8px; font-size: clamp(2rem, 5vw, 3.8rem); letter-spacing: 0; line-height: 1.02; }
          p { margin: 0 0 24px; color: #66706a; }
          table { width: 100%; border-collapse: collapse; overflow: hidden; border-radius: 8px; background: #fff; box-shadow: 0 22px 70px rgba(34, 32, 28, 0.10); }
          th, td { padding: 14px; border-bottom: 1px solid #d9ddd6; text-align: left; font-size: 0.94rem; }
          th { background: #2f4f45; color: #fff; }
          .topbar { display: flex; align-items: start; justify-content: space-between; gap: 16px; margin-bottom: 24px; }
          a { color: #2f4f45; font-weight: 800; }
          .logout { min-height: 40px; border: 0; border-radius: 999px; padding: 0 18px; background: #20211f; color: #fff; font-weight: 800; cursor: pointer; }
          @media (max-width: 720px) {
            .topbar { display: grid; }
            table, thead, tbody, tr, th, td { display: block; }
            thead { display: none; }
            tr { border-bottom: 1px solid #d9ddd6; padding: 12px; }
            td { border: 0; padding: 6px 0; overflow-wrap: anywhere; }
          }
        </style>
      </head>
      <body>
        <main>
          <div class="topbar">
            <div>
              <h1>Relatórios internos</h1>
              <p>PDFs gerados automaticamente quando o cliente envia o pré-briefing.</p>
            </div>
            <form method="post" action="/admin/logout">
              <button class="logout" type="submit">Sair</button>
            </form>
          </div>
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
