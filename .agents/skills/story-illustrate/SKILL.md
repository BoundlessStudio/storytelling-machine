---
name: story-illustrate
description: Make and review character sheets, location paintings and covers for the Storytelling Machine site from a pinned, reviewed story.
---

# Illustrating a reviewed story

The assignment starts with a story slug and a reviewed commit in Story Computing Machine. A new illustration belongs in the Storytelling Machine worktree. The `story_title_illustrator` agent can own an individual study or the cover.

## Read the edition

Read `stories/<slug>/story.md` and `ratings.md` at the specified commit. Consult the author's visual directions, including later changes, when supplied. Historical editions can use `05-story.md` and a bundle README. Inspect each approved original from the pinned story's `art/references/` inventory before using it. If a listed original is missing, request it before working on an image that depends on it. Use an earlier edition's generated art only after inspecting it against the current prose. Keep approved source originals and their filenames in the writing repository. A reference authorized for illustration can be used privately as an input.

Choose the people and important distinct settings from the whole story. Identify the moment or atmosphere a cover could offer a first-time reader, what the reader should still be able to discover for themselves, and the details the image must get right. Fit the art to the story's reviewed audience and any explicit visual directions.

## Establish the people and places

Use the imagegen skill. Keep candidates and working copies under this worktree's `tmp/`. For the collection's usual oil paintings, use broad, rhythmic colour and value shapes, directional opaque strokes, quiet connecting passages and selective areas of thick paint, in the tradition of Canada's Group of Seven. Let the scene determine its palette and light. For example, borrow a daytime painting's handling of a tree line for a night scene while preserving the night sky and the shapes that disappear into it. Inspect a small set of relevant collection images and identify the particular quality each one supplies.

- Give each principal character a separate sheet on plain white with the story and character names legible. Show the same person in story-relevant clothing across several views, poses and expressions. Leave hands empty and loose props out of the studies. Treat a multi-headed creature as one subject. Compare distinctive features across panels and with supplied originals.
- Paint each important setting as a place someone could occupy. Establish the geography, architecture, scale and source of light the prose gives it. A single-setting story can have one painting. When the action depends on multiple distinct locations, cover those locations, including ones outside the proposed cover scene.
- Inspect the actual saved images. Correct inconsistencies while the studies are still working files. Save accepted studies as `static/story-art/<slug>/art/characters/<character>.webp`, `art/landscapes/<place>.webp`, or `art/interiors/<place>.webp` under the same slug. Use descriptive filenames. Keep superseded candidates in scratch space.

## Make and review the cover

Use relevant accepted character and location studies as image inputs. Create a 9:16 portrait composition. Use the exact story title once, legible at library-card size. Save the accepted JPEG at 864 × 1536 pixels as `static/story-art/<slug>/title-image.jpg`. Check the saved pixels for identity, gesture, geography, light, type and objects with story significance. At thumbnail size, check what the eye encounters first and whether that promises the story the reader will actually open.

Include the slug, pinned prose revision, reference identifiers and their roles, and final asset paths in the artwork change description. Record any material visual interpretation there so the next illustrator knows what came from the page. Keep private inputs and generation drafts outside `static/`. Use the [site import and verification steps](../../../README.md#illustrate-and-import-a-story) to connect the approved art to the publication snapshot.
