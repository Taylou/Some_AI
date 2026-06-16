/// <reference types="cypress" />

// The "Clear" button wipes the conversation from the screen and calls the
// backend's DELETE /api/sessions/:id endpoint (README Exercise 2 + 3).
describe("Clear chat", () => {
  beforeEach(() => {
    cy.stubChat("Hello there!");
    cy.intercept("DELETE", "**/api/sessions/*", {
      statusCode: 200,
      body: { success: true, sessionId: "test-session-123" },
    }).as("deleteSession");
    cy.visit("/");
  });

  it("clears messages and deletes the session on the backend", () => {
    // Send a message so there is a session to clear.
    cy.byTestId("message-input").type("Hi");
    cy.byTestId("send-button").click();
    cy.wait("@chat");
    cy.contains("Hello there!").should("be.visible");

    // Clear it.
    cy.byTestId("clear-chat-button").click();

    // The DELETE endpoint is called with the session created above.
    cy.wait("@deleteSession")
      .its("request.url")
      .should("include", "/api/sessions/test-session-123");

    // The conversation is gone from the screen.
    cy.contains("Hello there!").should("not.exist");
  });

  it("does not call the backend when there is no session yet", () => {
    cy.byTestId("clear-chat-button").click();
    // No session was ever created, so no DELETE request should fire.
    cy.get("@deleteSession.all").should("have.length", 0);
  });
});
