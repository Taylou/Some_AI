import { AIService } from "./service";

export const createTutorSystem = () =>
  new AIService({
    model: "deepseek-r1:14b",
    systemPrompt:
      "You are a patient tutor. Explain concepts step-by-step in simple language.",
    temperature: 0.5,
  });

// export const createCreativeWriterSystem = () =>
//   new AIService({
//     model: "mistral",
//     systemPrompt:
//       "You are a creative storyteller. Use vivid imagery and emotional tone.",
//     temperature: 0.9,
//   });

// export const createCodeAssistantSystem = () =>
//   new AIService({
//     model: "codellama",
//     systemPrompt:
//       "You are an expert software engineer. Provide clean, production-ready code.",
//     temperature: 0.3,
//   });
