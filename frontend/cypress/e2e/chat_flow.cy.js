/// <reference types="cypress" />

// Sending a message and rendering the assistant reply.
// The backend is stubbed with cy.intercept so the test is deterministic and
// does not need Ollama/Redis running.
describe("Chat flow", () => {
  beforeEach(() => {
    cy.stubChat("Redis is an in-memory data structure store.");
    cy.visit("/");
  });

  it("sends a message and shows the assistant reply", () => {
    cy.byTestId("message-input").type("What is Redis?");
    cy.byTestId("send-button").click();

    // The user's message appears immediately.
    cy.contains("What is Redis?").should("be.visible");

    // The stubbed backend is hit and the reply is rendered.
    cy.wait("@chat");
    cy.contains("Redis is an in-memory data structure store.").should("be.visible");
  });

  it("forwards a sessionId on the second message", () => {
    cy.byTestId("message-input").type("First message");
    cy.byTestId("send-button").click();
    cy.wait("@chat").its("request.body.sessionId").should('not.exist');
    

    cy.byTestId("message-input").type("Second message");
    cy.byTestId("send-button").click();
    cy.wait("@chat").its("request.body.sessionId").should("eq", "test-session-123");
  });
});
