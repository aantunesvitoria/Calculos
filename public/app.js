const form = document.querySelector("#briefing-form");
const statusEl = document.querySelector("#form-status");
const submitButton = form.querySelector("button[type='submit']");
const adminLink = document.querySelector("[data-admin-link]");
const appConfig = window.APP_CONFIG || {};
const serverUrl = String(appConfig.serverUrl || "").replace(/\/$/, "");

function isStaticPagesHost() {
  return window.location.hostname.endsWith("github.io");
}

function setStatus(message, tone = "neutral") {
  statusEl.textContent = message;
  statusEl.dataset.tone = tone;
}

if (adminLink) {
  if (serverUrl) {
    adminLink.href = `${serverUrl}/admin`;
  }

  adminLink.addEventListener("click", (event) => {
    if (isStaticPagesHost() && !serverUrl) {
      event.preventDefault();
      setStatus("A área admin precisa da versão com servidor Node publicada.", "error");
      document.querySelector("#briefing-form").scrollIntoView({ behavior: "smooth", block: "start" });
    }
  });
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (window.location.protocol === "file:") {
    setStatus("Abra a página pelo servidor local: http://localhost:3000", "error");
    return;
  }

  if (isStaticPagesHost() && !serverUrl) {
    setStatus("Este link é apenas a versão estática. Publique o servidor para enviar o briefing.", "error");
    return;
  }

  const formData = new FormData(form);
  const payload = Object.fromEntries(formData.entries());

  submitButton.disabled = true;
  setStatus("Enviando...");

  try {
    const response = await fetch(`${serverUrl}/api/briefing`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const result = await response.json();

    if (!response.ok || !result.ok) {
      throw new Error(result.message || "Não foi possível enviar.");
    }

    form.reset();
    setStatus("Recebido. Obrigado por preencher o pré-briefing.", "success");
  } catch (error) {
    setStatus(error.message || "Não foi possível enviar agora.", "error");
  } finally {
    submitButton.disabled = false;
  }
});
