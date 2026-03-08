/**
 * @type {import('semantic-release').GlobalConfig}
 */
export default {
  branches: ["main"],
  plugins: [
    [
      "@semantic-release/commit-analyzer",
      {
        preset: "angular",
        releaseRules: [
          { type: "refactor", release: "patch" },
          { type: "perf", release: "patch" },
        ],
      },
    ],
    "@semantic-release/release-notes-generator",
    [
      "@semantic-release/changelog",
      { changelogFile: "CHANGELOG.md" },
    ],
    [
      "semantic-release-vsce",
      { packageVsix: true },
    ],
    [
      "@semantic-release/github",
      {
        assets: [
          {
            path: "*.vsix",
            label: "Flutter Audit v${nextRelease.version}",
          },
        ],
      },
    ],
    [
      "@semantic-release/git",
      {
        assets: ["CHANGELOG.md", "package.json"],
        message:
          "chore(release): ${nextRelease.version}\n\n${nextRelease.notes}",
      },
    ],
  ],
};
