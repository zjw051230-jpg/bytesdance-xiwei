# DSL EVPI Clarification

## Description
Chooses the next PM-facing clarification question using EVPI-lite, gap, risk, schema, and history signals.

## When to Use
- A PM clarification round needs the best next question.
- Repeated questions need deduplication.
- PM refusal, contradiction, or scope shift must be handled safely.

## Inputs
- candidateQuestions: questions from risk, schema, gap, score, DSL queue, and code context.
- clarificationHistory: previous PM and system turns.
- latestPmAnswer: optional newest PM answer.

## Outputs
- questions: one to three natural PM-facing questions.
- normalizedKeys: deduplication keys.
- selectionReason: why each question was chosen.

## Steps
1. Collect candidate questions from all signals.
2. Render internal fields into natural product language.
3. Deduplicate by exact text, key, target field, and factor.
4. Boost repo-grounded questions only with candidate wording.
5. Select the highest-value safe question and preserve draft-only readiness.

## Safety Rules
- Run as dry-run guidance only.
- Do not perform real repository writes.
- Do not call a live model or agent runtime.
- Do not read or output credential values.
- Keep candidate code context as candidate evidence until separately verified.

## Validation
- No repeated consecutive question.
- Question does not expose internal field names.
- Refusal or contradiction remains a blocker.

## Example
Input: PM refuses to define success state. Output: ask one narrower success-state question and mark refusal as unresolved if still unanswered.
