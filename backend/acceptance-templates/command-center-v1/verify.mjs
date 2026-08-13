import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

await access(".pi/prompts/command-check.md");
await access(".pi/skills/command-check/SKILL.md");
await access(".pi/extensions/command-check.ts");
const prompt = await readFile(".pi/prompts/command-check.md", "utf8");
const skill = await readFile(".pi/skills/command-check/SKILL.md", "utf8");
assert.match(prompt, /FF-COMMAND-PROMPT-OK/);
assert.match(skill, /FF-COMMAND-SKILL-OK/);
console.log("command center acceptance passed");
