import { execFileSync } from "node:child_process";

type Label = {
  name: string;
  color: string;
  description: string;
};

// The repository's issue labels. Status and priority labels drive the workflow in
// CONTRIBUTING.md#issues-and-pull-requests; the rest say what kind of work it is.
const labels: Label[] = [
  { name: "needs triage", color: "ededed", description: "Not reviewed yet. Don't work on it." },
  { name: "ready", color: "0e8a16", description: "Reviewed and free to pick up" },
  { name: "in progress", color: "fbca04", description: "Taken: someone is working on it" },
  { name: "blocked", color: "b60205", description: "Waiting on something else" },
  {
    name: "epic",
    color: "3e4b9e",
    description: "Parent tracking issue grouping sub-issues; never labeled ready",
  },
  { name: "p0: critical", color: "b60205", description: "Highest priority; do first" },
  { name: "p1: high", color: "d93f0b", description: "High priority for the current milestone" },
  { name: "p2: medium", color: "fbca04", description: "Normal priority" },
  { name: "p3: low", color: "c5def5", description: "Nice to have or later milestone" },
  { name: "bug", color: "d73a4a", description: "Doesn't work as described" },
  { name: "enhancement", color: "a2eeef", description: "New feature or improvement" },
  { name: "performance", color: "f9d0c4", description: "Speed, memory, or bundle size" },
  { name: "refactor", color: "c5def5", description: "Cleanup with no change in behavior" },
  { name: "documentation", color: "0075ca", description: "Docs only" },
  { name: "dependencies", color: "0366d6", description: "Dependency updates" },
  { name: "release", color: "5319e7", description: "Needed to publish a release" },
];

function run(): void {
  for (const label of labels) {
    execFileSync(
      "gh",
      [
        "label",
        "create",
        label.name,
        "--color",
        label.color,
        "--description",
        label.description,
        "--force",
      ],
      { stdio: "inherit" },
    );
  }
}

run();
