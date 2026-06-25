const form = document.querySelector("#briefing-form");
const statusEl = document.querySelector("#form-status");
const submitButton = form.querySelector("button[type='submit']");
const adminLink = document.querySelector("[data-admin-link]");
const dialogOverlay = document.querySelector("#dialog-overlay");
const dialogTitle = document.querySelector("#dialog-title");
const dialogMessage = document.querySelector("#dialog-message");
const dialogConfirm = document.querySelector("#dialog-confirm");
const dialogCancel = document.querySelector("#dialog-cancel");
const appConfig = window.APP_CONFIG || {};
const serverUrl = String(appConfig.serverUrl || "").replace(/\/$/, "");

form.noValidate = true;

function isStaticPagesHost() {
  return window.location.hostname.endsWith("github.io");
}

function setStatus(message, tone = "neutral") {
  statusEl.textContent = message;
  statusEl.dataset.tone = tone;
}

function formatPhone(value) {
  const digits = value.replace(/\D+/g, "").slice(0, 11);
  if (!digits) return "";
  const parts = [];
  parts.push(digits.slice(0, 2));
  if (digits.length > 2) {
    parts.push(digits.slice(2, 7));
  }
  if (digits.length > 7) {
    parts.push(digits.slice(7));
  }
  return parts.reduce((formatted, part, index) => {
    if (index === 0) return `(${part}`;
    if (index === 1) return `${formatted}) ${part}`;
    return `${formatted}-${part}`;
  }, "");
}

function formatCurrency(value) {
  const digits = value.replace(/[^\d]/g, "");
  if (!digits) return "";
  const number = Number(digits);
  return number.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function parseCurrency(value) {
  return Number(String(value).replace(/[^\d]/g, "")) || 0;
}

function clearInvalidStates() {
  form.querySelectorAll(".invalid").forEach((input) => {
    input.classList.remove("invalid");
    input.removeAttribute("aria-invalid");
  });
}

function showDialog({ title, message, confirmLabel = "OK", cancelLabel = null }) {
  dialogTitle.textContent = title;
  dialogMessage.textContent = message;
  dialogConfirm.textContent = confirmLabel;

  if (cancelLabel) {
    dialogCancel.textContent = cancelLabel;
    dialogCancel.style.display = "inline-flex";
  } else {
    dialogCancel.style.display = "none";
  }

  dialogOverlay.classList.add("active");
  dialogOverlay.setAttribute("aria-hidden", "false");
  dialogConfirm.focus();
}

function hideDialog() {
  dialogOverlay.classList.remove("active");
  dialogOverlay.setAttribute("aria-hidden", "true");
}

function validateForm() {
  clearInvalidStates();
  const requiredFields = [
    { name: "name", label: "Nome completo" },
    { name: "phone", label: "WhatsApp" },
    { name: "propertyType", label: "Tipo de imóvel" },
    { name: "propertyStatus", label: "Situação atual" },
    { name: "area", label: "Área aproximada" },
    { name: "rooms", label: "Quantidade de ambientes" },
    { name: "scope", label: "Escopo desejado" }
  ];

  const errors = [];
  let firstInvalid = null;

  requiredFields.forEach((field) => {
    const input = form.elements[field.name];
    if (!input) return;

    const value = String(input.value || "").trim();
    if (!value) {
      input.classList.add("invalid");
      input.setAttribute("aria-invalid", "true");
      if (!firstInvalid) {
        firstInvalid = input;
      }
      errors.push(`Campo obrigatório: ${field.label}`);
      return;
    }

    if (field.name === "phone" && String(value).replace(/\D+/g, "").length < 10) {
      input.classList.add("invalid");
      input.setAttribute("aria-invalid", "true");
      if (!firstInvalid) {
        firstInvalid = input;
      }
      errors.push("Telefone incompleto. Use o formato correto com DDD.");
    }

    if (field.name === "area" || field.name === "rooms") {
      const numberValue = Number(value);
      if (!Number.isFinite(numberValue) || numberValue < 1) {
        input.classList.add("invalid");
        input.setAttribute("aria-invalid", "true");
        if (!firstInvalid) {
          firstInvalid = input;
        }
        errors.push(`${field.label} deve ser um número maior que zero.`);
      }
    }
  });

  const email = form.elements.email;
  if (email && email.value.trim()) {
    const isValidEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim());
    if (!isValidEmail) {
      email.classList.add("invalid");
      email.setAttribute("aria-invalid", "true");
      if (!firstInvalid) {
        firstInvalid = email;
      }
      errors.push("E-mail inválido. Verifique o endereço digitado.");
    }
  }

  if (firstInvalid) {
    firstInvalid.focus();
  }

  return errors;
}

function getPayload() {
  const formData = new FormData(form);
  const payload = Object.fromEntries(formData.entries());
  payload.budget = parseCurrency(payload.budget || "");
  return payload;
}

function handleSuccess() {
  form.reset();
  setStatus("Recebido. Obrigado por preencher o pré-briefing.", "success");
  showDialog({ title: "Pronto!", message: "Seu pré-briefing foi enviado com sucesso.", confirmLabel: "Fechar" });
}

async function sendPayload(payload) {
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

    handleSuccess();
  } catch (error) {
    setStatus(error.message || "Não foi possível enviar agora.", "error");
    showDialog({ title: "Erro de envio", message: error.message || "Não foi possível enviar agora.", confirmLabel: "Entendi" });
  } finally {
    submitButton.disabled = false;
  }
}

function openConfirmation(payload) {
  const message = `Confirme o envio do pré-briefing. Verifique se os dados estão corretos antes de continuar.`;
  showDialog({ title: "Confirmar envio", message, confirmLabel: "Enviar", cancelLabel: "Cancelar" });

  const handleConfirm = async () => {
    dialogConfirm.removeEventListener("click", handleConfirm);
    dialogCancel.removeEventListener("click", handleCancel);
    hideDialog();
    await sendPayload(payload);
  };

  const handleCancel = () => {
    dialogConfirm.removeEventListener("click", handleConfirm);
    dialogCancel.removeEventListener("click", handleCancel);
    hideDialog();
    setStatus("Envio cancelado. Revise seus dados antes de tentar novamente.", "neutral");
  };

  dialogConfirm.addEventListener("click", handleConfirm);
  dialogCancel.addEventListener("click", handleCancel);
}

function attachMasking() {
  const phoneInput = form.elements.phone;
  const budgetInput = form.elements.budget;

  if (phoneInput) {
    phoneInput.addEventListener("input", (event) => {
      const formatted = formatPhone(event.target.value);
      event.target.value = formatted;
    });
  }

  if (budgetInput) {
    budgetInput.addEventListener("input", (event) => {
      const formatted = formatCurrency(event.target.value);
      event.target.value = formatted;
    });
  }
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

form.addEventListener("submit", (event) => {
  event.preventDefault();

  if (window.location.protocol === "file:") {
    showDialog({ title: "Abrir no servidor", message: "Abra a página pelo servidor local: http://localhost:3000", confirmLabel: "Entendi" });
    setStatus("Abra a página pelo servidor local: http://localhost:3000", "error");
    return;
  }

  if (isStaticPagesHost() && !serverUrl) {
    showDialog({ title: "Versão estática", message: "Este link é apenas a versão estática. Publique o servidor para enviar o briefing.", confirmLabel: "Entendi" });
    setStatus("Este link é apenas a versão estática. Publique o servidor para enviar o briefing.", "error");
    return;
  }

  const errors = validateForm();
  if (errors.length) {
    setStatus("Existem campos incorretos ou faltantes.", "error");
    showDialog({ title: "Corrija os campos", message: errors.join("\n"), confirmLabel: "Entendi" });
    return;
  }

  const payload = getPayload();
  openConfirmation(payload);
});

dialogOverlay.addEventListener("click", (event) => {
  if (event.target === dialogOverlay) {
    hideDialog();
  }
});

dialogConfirm.addEventListener("click", () => {
  hideDialog();
});

attachMasking();
