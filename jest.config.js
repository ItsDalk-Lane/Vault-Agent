module.exports = {
  preset: "ts-jest",
  testEnvironment: "jsdom",
  roots: ["<rootDir>/src", "<rootDir>/dev", "<rootDir>/scripts"],
  transform: {
    "^.+\\.(js|jsx|ts|tsx)$": "ts-jest",
    "^.+\\.md$": "<rootDir>/jest.textTransform.js",
  },
  moduleNameMapper: {
    "\\.svg$": "<rootDir>/__mocks__/svg.js",
    "^@/(.*)$": "<rootDir>/src/$1",
    "^obsidian$": "<rootDir>/__mocks__/obsidian.js",
    "^yaml$": "<rootDir>/node_modules/yaml/dist/index.js",
    "^react-resizable-panels$": "<rootDir>/__mocks__/react-resizable-panels.js",
  },
  testRegex: ".*\\.test\\.(jsx?|tsx?)$",
  moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json", "node", "md"],
  testPathIgnorePatterns: ["/node_modules/"],
  transformIgnorePatterns: [
    "[/\\\\]node_modules[/\\\\](?!openartifacts[/\\\\])",
    "\\.pnp\\.[^\\/]+$",
  ],
  setupFiles: ["<rootDir>/jest.setup.js"],
};
