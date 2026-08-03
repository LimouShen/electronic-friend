# AGENTS.md

## Project Identity

This project is a private emotional companionship AI app, not a productivity agent.

The product goal is to build a highly personalized electronic friend with stable persona, long-term memory, and emotionally intelligent conversation.

Do not turn this project into a task assistant, automation agent, calendar tool, email tool, or productivity workflow system unless explicitly requested.

## Required Repository Structure

Codex must follow this structure:

electronic-friend/
  docs/
    product-requirements.md
    persona-card.md
    memory-rules.md
    conversation-style.md
    safety-boundary.md

  apps/
    web/
      # Mobile-first PWA / frontend chat app

    api/
      # Backend API, conversation orchestration, memory, model calls

  data/
    # Local development database only

  prompts/
    system-prompt.md
    memory-extractor.md
    response-rewriter.md
    emotion-classifier.md

## Directory Rules

- Put frontend code only under apps/web.
- Put backend code only under apps/api.
- Put prompt templates only under prompts.
- Put product, persona, and design documents only under docs.
- Do not create new top-level directories without explaining why.
- Do not mix frontend and backend code.
- Do not store secrets or API keys in the repository.
- Do not hardcode private user data in source code.

## Product Constraints

- The app must prioritize emotional companionship.
- Avoid tool-use features unless explicitly requested.
- The bot should not pretend to be a real human.
- The bot should not act as a therapist.
- The bot should maintain a stable persona.
- Memory must be inspectable, editable, and deletable by the user.

## Implementation Style

- Prefer simple, readable code.
- Avoid over-engineering.
- Add comments for non-obvious logic.
- Keep modules small and understandable.
- Before coding, explain which files will be changed.
- After coding, summarize what changed and how to run or test it.

## Definition of Done

A task is complete only when:
- Files are placed in the correct directories.
- The app still follows the product positioning.
- No unnecessary tool-agent features are added.
- The user can understand what changed.
- Any new command or dependency is documented.