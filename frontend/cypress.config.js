const { defineConfig } = require("cypress");

// Expo's web dev server (`npm run web`) serves on port 8081 by default.
// Override with CYPRESS_BASE_URL if you run it elsewhere.
module.exports = defineConfig({
  e2e: {
    baseUrl: process.env.CYPRESS_BASE_URL || "http://localhost:8081",
    specPattern: "cypress/e2e/**/*.cy.{js,jsx}",
    supportFile: "cypress/support/e2e.js",
    // Expo web can be slow to compile the first bundle — be generous.
    defaultCommandTimeout: 10000,
    pageLoadTimeout: 120000,
    video: false,
  },
});
