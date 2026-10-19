# Third-party skill notices

This directory contains skills copied or adapted from the projects below. Local changes tailor their workflows and supporting material to this repository. Attribution does not imply endorsement by the original authors.

The paths below are relative to `.agents/skills/`. Each entry covers the skill directory and its supporting files. Shared material adapted from Addy Osmani's project also lives in `.agents/references/`.

These notices apply to the third-party material, including modified copies. The application's [MIT license](../../LICENSE) is unchanged. Keep the applicable notices with any copies or distributions of these skills and their supporting material.

## Addy Osmani — agent-skills

Source: [addyosmani/agent-skills](https://github.com/addyosmani/agent-skills).

Copied or adapted skills:

- `api-and-interface-design/`
- `browser-testing-with-devtools/`
- `ci-cd-and-automation/`
- `code-review-and-quality/`
- `code-simplification/`
- `constraint-driven-development/`
- `context-engineering/`
- `debugging-and-error-recovery/`
- `deprecation-and-migration/`
- `documentation-and-adrs/`
- `doubt-driven-development/`
- `frontend-ui-engineering/`
- `git-workflow-and-versioning/`
- `idea-refine/`
- `incremental-implementation/`
- `observability-and-instrumentation/`
- `performance-optimization/`
- `planning-and-task-breakdown/`
- `security-and-hardening/`
- `shipping-and-launch/`
- `source-driven-development/`
- `spec-driven-development/`
- `test-driven-development/`
- `using-agent-skills/`

Also covers shared material in `.agents/references/` adapted from the upstream `references/` directory.

[Upstream license](https://github.com/addyosmani/agent-skills/blob/aeac41d4d005999432bb7312f7ff06383a91d59d/LICENSE):

```text
MIT License

Copyright (c) 2025 Addy Osmani

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Effect-TS — skills

Source: [Effect-TS/skills](https://github.com/Effect-TS/skills).

Copied or adapted skill: `effect-ts/`, from upstream `skills/effect-ts/`. The source is also recorded in [`skills-lock.json`](../../skills-lock.json).

[Upstream license](https://github.com/Effect-TS/skills/blob/155c50c911f9c99c294ef8a4461981c5bbe6453e/LICENSE):

```text
MIT License

Copyright (c) 2023 Effectful Technologies Inc

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Matt Pocock — skills

Source: [mattpocock/skills](https://github.com/mattpocock/skills).

Copied or adapted skills:

| Local directory | Upstream directory |
| --- | --- |
| `codebase-design/` | `skills/engineering/codebase-design/` |
| `domain-modeling/` | `skills/engineering/domain-modeling/` |
| `grill-with-artifacts/` | `skills/engineering/grill-with-docs/` |
| `grilling/` | `skills/productivity/grilling/` |
| `handoff/` | `skills/productivity/handoff/` |
| `improve-codebase-architecture/` | `skills/engineering/improve-codebase-architecture/` |
| `pr/` | `skills/engineering/pr/` |
| `retro/` | `skills/engineering/retro/` |
| `writing-for-agents/` | `skills/productivity/writing-for-agents/` |

[`skills-lock.json`](../../skills-lock.json) also records sources for `grilling/`, `retro/`, and `writing-for-agents/`. The `pr/` skill includes material credited upstream to HumanLayer's `show-me`; the HumanLayer notice below applies to that material too.

[Upstream license](https://github.com/mattpocock/skills/blob/49dd158d1076134a641b33efb035946536778336/LICENSE):

```text
MIT License

Copyright (c) 2026 Matt Pocock

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## HumanLayer — skills

Source: [humanlayer/skills](https://github.com/humanlayer/skills).

The modified local `show-me/` skill comes from [`plugins/show-me/skills/show-me/`](https://github.com/humanlayer/skills/tree/653b6411c1f70c275a18e37673b042ff99f67ceb/plugins/show-me/skills/show-me). The local `pr/` skill also incorporates `show-me` material through Matt Pocock's `pr` skill, whose credits name Dex Horthy and HumanLayer. Existing credits are retained.

[Upstream license](https://github.com/humanlayer/skills/blob/653b6411c1f70c275a18e37673b042ff99f67ceb/LICENSE):

```text
MIT License

Copyright (c) 2026 HumanLayer

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
