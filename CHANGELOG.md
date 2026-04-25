# Changelog

All notable changes to this project will be documented in this file.
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- feat(infra): Docker multi-stage build, docker-compose with PostgreSQL, .dockerignore
- docs: Getting-started guide covering local dev, Docker, and Google OAuth setup
- feat(testing): Vitest test suite — 49 tests across 7 suites (API routes, lib, components)
- feat(auth): Email/password registration and login with bcryptjs; Credentials provider in NextAuth v5;  JWT session strategy; `/register` page
- feat(google): Post-login Google Calendar sync flow — prompt → multi-select calendar picker → bulk sync → results; `/google/connect` page; `/api/google/sync/bulk` route; Checkbox component
- feat(appearance): Calendar theme settings — dark/light/system mode, 6 accent colours, 4 border-radius presets, comfortable/compact density; persisted to localStorage; no DB required

### Changed
- refactor(auth): NextAuth switched from database to JWT session strategy (required for Credentials provider); Google login now redirects to `/google/connect` for new users
- refactor(middleware): Added `/google/:path*` to auth-protected matcher so `/google/connect` requires login

### Maintenance
- chore(schema): Added `password String?` field to User model (run `pnpm db:push` to apply)

