const form = document.querySelector("#briefing-form");
const statusEl = document.querySelector("#form-status");
const submitButton = form.querySelector("button[type='submit']");

function setStatus(message, tone = "neutral") {
  statusEl.textContent = message;
  statusEl.dataset.tone = tone;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (window.location.protocol === "file:") {
    setStatus("Abra a página pelo servidor local: http://localhost:3000", "error");
    return;
  }

  const formData = new FormData(form);
  const payload = Object.fromEntries(formData.entries());

  submitButton.disabled = true;
  setStatus("Enviando...");

  try {
    const response = await fetch("/api/briefing", {
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
