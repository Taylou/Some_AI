// Custom Cypress commands shared across specs.
//
// react-native-web renders a component's `testID` prop as a `data-testid`
// DOM attribute. This helper keeps the specs readable:
//
//   cy.byTestId("send-button").click();
//
Cypress.Commands.add("byTestId", (testId) => cy.get(`[data-testid="${testId}"]`));

// Stub the backend's POST /api/chat so E2E runs without Ollama/Redis.
// Pass the assistant reply you want the fake backend to return.
Cypress.Commands.add("stubChat", (reply, sessionId = "test-session-123") => {
  cy.intercept("POST", "**/api/chat", {
    statusCode: 200,
    body: { sessionId, reply },
  }).as("chat");
});
