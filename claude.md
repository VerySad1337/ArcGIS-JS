# CLAUDE.md

## Mission
This repository follows a documentation-first workflow.
The knowledge base is the authoritative source of truth for architecture, subsystem behavior, responsibilities, and implementation intent.
Before performing any task, consult the knowledge base before analyzing source code.

---

# Required Reading Order

For every task, read the following files in order:

1. `knowledge/index.md`
2. `knowledge/architecture.md`
3. `knowledge/features/drawing-system.md`
4. `knowledge/features/upload-system.md`

Do not skip files that exist.
If a referenced file is unavailable, report:
> Referenced but unavailable
and continue with the remaining documentation.

---

# Knowledge Base Authority

Documentation represents intended system behavior.
When implementation and documentation differ:
1. Assume documentation reflects intended behavior.
2. Identify implementation deviations.
3. Report discrepancies.
4. Recommend updates to either documentation or implementation.
5. Do not silently redefine architecture.

---

# Repository Access Rules

Always respect `.claudeignore`.
Do not read, analyze, index, search, summarize, or reference files excluded by `.claudeignore`.
If required information exists only in ignored files, report:
> Required file is excluded by .claudeignore
Do not bypass `.claudeignore` unless explicitly instructed by the user.

---

# Token Efficiency Rules

Minimize context usage at all times.
Never perform repository-wide analysis.
Never recursively scan the entire project.
Never create a full repository map.
Never search all files for symbols, imports, classes, functions, or patterns unless explicitly requested.
Avoid opening files that are unrelated to the current task.
Prefer targeted file access.
Use documentation before source code.

---

# Scope Control

Only analyze files referenced by:

* `knowledge/index.md`
* `knowledge/architecture.md`
* `knowledge/drawing-system.md`
* `knowledge/upload-system.md`

Do not inspect unrelated files unless:

* Required to understand a documented dependency.
* Required to trace a documented execution path.
* Explicitly requested by the user.

When accessing additional files, explain why they are required.

---

# Knowledge Base Maintenance

The knowledge base must remain current.

When new architectural information is discovered:

1. Determine the appropriate knowledge document.
2. Generate documentation updates.
3. Preserve existing terminology.
4. Maintain consistency across all documents.

If documentation is missing:

1. Identify the gap.
2. Propose documentation updates.
3. Generate content for review.

---

# Architecture Documentation

Primary reference:

`knowledge/architecture.md`

Focus on:

* System architecture
* Component relationships
* Application flow
* Data flow
* State management
* Layer ownership
* Service boundaries
* GIS engine responsibilities
* UI responsibilities
* 2D / 3D architecture

All architectural recommendations must align with documented architecture.

---

# Drawing System

Primary reference:

`knowledge/drawing-system.md`

Relevant implementation:

* `src/gis/GISMapEngine.js`
* `src/components/FloatingDrawTools.jsx`
* `src/components/GISMapView.jsx`

Focus on:

* Drawing lifecycle
* SketchViewModel integration
* Graphic creation
* GraphicsLayer management
* Point drawing
* Polyline drawing
* Polygon drawing
* Drawing persistence
* Feature extraction
* Layer synchronization
* 2D / 3D behavior

Do not introduce alternative drawing workflows unless explicitly requested.

---

# Upload System

Primary reference:

`knowledge/upload-system.md`

Relevant implementation:

* `src/gis/GISMapEngine.js`
* `src/components/FloatingDrawTools.jsx`
* `src/app/ApplicationShell.jsx`

Focus on:

* GeoJSON upload workflow
* GeoJSON validation
* Feature conversion
* Graphic creation
* Drawing layer synchronization
* Upload persistence
* Error handling
* User feedback

Maintain compatibility with existing drawing workflows.

---

# Routing System

Primary reference:

`knowledge/index.md`

Relevant implementation:

* `src/app/ApplicationShell.jsx`
* `src/services/RoutingService.js`
* `src/services/GeocodingService.js`

Focus on:

* Geocoding flow
* Route generation
* Stop rendering
* Route rendering
* Service integration

---

# Heatmap System

Primary reference:

`knowledge/index.md`

Relevant implementation:

* `src/gis/GISMapEngine.js`
* `src/hooks/useHeatmapAnalysis.js`
* `src/app/ApplicationShell.jsx`

Focus on:

* Heatmap lifecycle
* Renderer configuration
* Intensity updates
* Visibility control

---

# MRT Layer System

Primary reference:

`knowledge/index.md`

Relevant implementation:

* `src/config/ArcGISConfiguration.js`
* `src/gis/GISMapEngine.js`

Focus on:

* Station layers
* Line layers
* Feature service integration
* Renderer configuration
* Visibility management

---

# 2D / 3D View System

Primary reference:

`knowledge/index.md`

Relevant implementation:

* `src/components/GISMapView.jsx`
* `src/app/ApplicationShell.jsx`

Focus on:

* View switching
* State synchronization
* WebMap integration
* WebScene integration
* Layer persistence
* Drawing persistence

---

# Analysis Workflow

Before answering implementation questions:

1. Identify relevant subsystem.
2. Read corresponding documentation.
3. Summarize documented behavior.
4. Analyze implementation.
5. Compare implementation against documentation.
6. Identify deviations.
7. Explain findings.
8. Recommend changes.

Never skip documentation review.

---

# Bug Investigation Workflow

For bug reports:

1. Read relevant knowledge documents.
2. Describe expected behavior.
3. Trace actual behavior.
4. Identify root cause.
5. Explain impact.
6. Recommend fix.
7. Recommend documentation updates if needed.

Never provide speculative fixes.

Never patch blindly.

Always identify root cause first.

---

# Code Generation Rules

When generating code:

* Preserve documented architecture.
* Maintain subsystem boundaries.
* Reuse existing services.
* Reuse existing layers.
* Avoid duplicate functionality.
* Avoid unnecessary abstractions.
* Keep implementations consistent with existing patterns.
* Explain architectural impact when modifying core systems.

---

# Refactoring Rules

Before refactoring:

1. Verify existing behavior.
2. Verify architectural intent.
3. Preserve external behavior.
4. Document significant changes.

Do not refactor solely for stylistic reasons.

Favor consistency over novelty.

---

# Documentation Generation Rules

When generating documentation:

* Use the knowledge base as the primary source.
* Use implementation as supporting evidence.
* Avoid speculation.
* Mark assumptions clearly.
* Keep terminology consistent.
* Update relevant knowledge documents when gaps are discovered.

---

# Response Format

For technical requests, use the following structure:

## Documentation Review

* Relevant documentation consulted
* Documented behavior

## Implementation Analysis

* Files analyzed
* Actual implementation

## Findings

* Matches documentation
* Deviations
* Risks

## Recommended Changes

* Proposed solution
* Documentation updates required

---

# Repository Search Restrictions

Unless explicitly requested, do NOT:

* Scan the entire repository
* Search every file
* Generate repository-wide summaries
* Build dependency graphs for the whole project
* Index all source code
* Open unrelated directories

Use the smallest possible set of files needed to complete the task.

---

# Knowledge Base Goal

The knowledge base is the single source of truth for:

* Architecture
* Drawing System
* Upload System
* Routing System
* Heatmap System
* MRT Layer System
* 2D / 3D View System

All future implementation, analysis, debugging, refactoring, and documentation tasks must begin with the knowledge base.
