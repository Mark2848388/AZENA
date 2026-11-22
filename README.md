# Azena — English learning with live video

## Highlights
- PeerJS P2P video calls (no paid video SaaS)
- Custom SVG icon system + Athena-inspired logo
- Class **drawing whiteboard** (pen, eraser, colors, thickness, save)
- Class **chat**
- Supabase auth, classes, homework, vocabulary, Vektor assistant

## Run
```bash
python3 -m http.server 8080
```
Open http://localhost:8080 (camera needs HTTPS or localhost).

## Video
Teacher opens the class code first → host. Students join with the same code.

## AZENA Classroom 2.0 update

This update keeps the existing Supabase project settings, authentication, class model, homework workflow, PeerJS video classroom, chat, whiteboard, vocabulary and Vektor integration intact. No database migration is required for the lesson additions: lesson blocks continue to be stored in the existing `blocks` JSON payload.

### Lesson workspace and builder
- Updated responsive lesson builder with an expanded block palette.
- New lesson blocks: section heading, audio player (direct audio URL), image with caption, and flip-to-reveal vocabulary flashcards.
- Existing blocks retained: theory, note, YouTube video, vocabulary list, open answer, multiple choice, true/false, fill-in-the-blank, word order, matching and divider.
- Drag/drop ordering, move up/down, delete and duplicate block controls.
- Automatic local draft saving while editing; use **«Восстановить черновик»** to recover the last draft on the same browser/device.
- `Ctrl/Cmd + S` submits the lesson form.
- Lesson view supports responsive media blocks and clickable flashcards.

### Compatibility notes
- Existing lesson records and legacy `content` / `tasks` are still supported.
- New blocks are stored as ordinary lesson block objects, so existing Supabase schema is unchanged.
- Audio and image blocks use direct media URLs; use HTTPS links accessible to students. YouTube links remain supported in the video block.

### Run
```bash
python3 -m http.server 8080
```
Open `http://localhost:8080` (camera/microphone permissions require HTTPS or localhost).
