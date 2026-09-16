# Micromanaged Driven Development (MMDD) - version 5

You are assisting development under MMDD: granular task breakdown, chronological documentation, developer approval at every step. Never implement without an approved plan. Never batch large changes.

## Structure

Work is organized into **units** (major phases/components), optionally split into **subunits** (discrete build moments). Each lives in `dev_log/`:

```
<sequence>_<unitname>.md                        # plan
<sequence>_<unitname>_test.md                   # test instructions
<sequence>_<unitname>_done.md                   # completion context
<sequence>_<unitname>_<NN>[_test|_done].md            # subunit variants (two-digit, e.g. 02_auth_01.md)
```

Rules:
- Unit names: one word, lowercase
- Create files only when they have content — no empty placeholders
- `00_mmdd.md` is this file; `00_main.md` is the project plan and status index

## Workflow: 5-Step Cycle

Apply this cycle at project level (first setup) and per unit.

**1. Create Context.** Before planning, confirm with the developer: objective, how it fits the project, technical constraints, dependencies on prior units. Ask if anything is unclear. Do not proceed on assumptions.

**2. Plan and Define.** Draft the plan file (project: `00_main.md` with 3-5 initial units; unit: `<NN>_<name>.md`). Present it for review. Iterate until the developer explicitly approves. Do not implement before approval.

**3. Implementation.** Execute in small increments. Validate each piece before the next. For code units, create `_test.md` alongside or during implementation. Split into subunits when complexity warrants.

**4. Test and Validate.** Run tests per `_test.md`. Summarize what was implemented and list validation points for the developer to confirm.

**5. Commit.** Create `_done.md` capturing actual implementation and deviations from plan. Update `00_main.md` to current state. Then commit.

Commit format:
- Title: `Complete Project Plan` | `Complete Unit XX: [Name]` | `Complete Unit XX: [Name] - [Subunit]`
- Body: concise what/why, key files or features. No detailed how.

When starting a new unit, request `00_main.md` and related unit files if not provided.

## Templates

### 00_main.md

```markdown
# Project Plan and Dev Log

[Brief project description and development approach]

## Structure
[Unit/subunit organization and naming convention]

## About the Project
### What This Is
### Architecture
### Technical Stack

## Project Status
### Overall Completion
### Completed Features

## Units Implemented
### Completed Units
* **01**: Unit Name - Brief description

### Units In Progress
#### 02. Current Unit Name
**Status:** [Done / pending]

## Planned Units
* **03**: Future Unit - Description
```

### Unit / Subunit Plan

```markdown
# Unit [N]: [Unit Name][ - Subunit: [Subunit Name]]

## Objective

## Implementation

## AI Interactions

## Files Modified

## Status: [Complete/In Progress]
```

### Test (`_test.md`)

```markdown
# Unit [N]: [Unit Name] - Test Instructions

## Test Objectives

## Manual Tests

## Automated Tests

## Integration Checks

## Success Criteria
```

### Done (`_done.md`)

```markdown
# Unit [N]: [Unit Name] - Completion Context

## What Was Implemented

## Key Decisions

## Deviations from Plan

## Files Modified

## Integration Notes

## Lessons Learned
```