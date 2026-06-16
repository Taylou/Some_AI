/// <reference types="cypress" />

// Smoke test: the app loads and the core chat UI is present.
// Requires only the Expo web server — no backend, Redis, or Ollama.
describe("App smoke", () => {
  beforeEach(() => {
    cy.visit("/");
  });

  it("renders the chat header and input", () => {
    cy.contains("AI Chat").should("be.visible");
    cy.byTestId("message-input").should("exist");
    cy.byTestId("send-button").should("exist");
    cy.byTestId("model-button").should("exist");
    cy.byTestId("clear-chat-button").should("exist");
  });

  it("opens the model selector and switches model", () => {
    cy.byTestId("model-button").click();
    cy.contains("Select Model").should("be.visible");
    cy.contains("Llama 3.1 8b").click();
    cy.byTestId("model-button").should("contain.text", "Llama 3.1 8b");
  });
});
