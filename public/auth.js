const form = document.querySelector("#auth-form");
const error = document.querySelector("#auth-error");

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  error.textContent = "";
  const button = form.querySelector("button");
  button.disabled = true;
  try {
    const response = await fetch(form.dataset.action, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: form.username.value,
        password: form.password.value,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Não foi possível concluir.");
    location.href = "/";
  } catch (err) {
    error.textContent = err.message;
    button.disabled = false;
  }
});
