# CONTINUE — FINISH THE CURRENT PASS, VERIFY PERFORMANCE, THEN COMPLETE VISUAL REALISM

Do NOT stop at the current measurement stage.

You have already identified two important performance issues:

1. Shadow baking introduced approximately 4.3 seconds of additional stall during a fast walkthrough.
2. A pre-existing LOD geometry rebuild system contributes approximately 10 seconds of stall during the same aggressive stress test.

You have already changed the shadow bake scheduler to wait until the camera is actually parked for 5 consecutive frames, with a deferral cap.

Now continue the implementation systematically.

---

# PHASE 1 — VERIFY THE SHADOW-BAKE FIX

First, obtain a genuinely valid post-fix measurement.

The browser MUST be visible and actively rendering.

Do NOT record performance numbers while:

* Chrome is hidden
* the terminal is covering Chrome
* the tab is backgrounded
* requestAnimationFrame is suspended

If your environment allows window management:

* put Chrome and the terminal side-by-side, OR
* keep Chrome focused and visible while measuring.

If the environment does NOT allow reliable window management, do not fabricate measurements.

Instead explicitly report that the measurement could not be obtained because the browser visibility condition could not be established.

---

# PHASE 2 — RUN THE SAME A/B TEST

Use the SAME stress test for comparability.

Measure:

### A

Shadow bakes ON.

### B

Shadow bakes OFF.

Use the same:

* starting point
* camera
* traversal
* number of effective key presses
* corridor route
* warm 3rd-walk condition

Record:

* median frame time
* p90/p95
* maximum frame time
* total stalls
* total stall duration
* number of shadow bakes

Do not change the test methodology between A and B.

---

# PHASE 3 — VALIDATE THE NEW SCHEDULER

Specifically determine:

### During continuous movement

Are shadow bakes happening?

They should generally NOT happen while the patient is actively walking.

### When the patient stops

Does the bake occur after the camera has genuinely settled?

### When the patient resumes movement

Does the system avoid immediately triggering another expensive bake?

The objective is:

```text
WALKING
↓
NO EXPENSIVE BAKE

PATIENT STOPS
↓
CAMERA SETTLES
↓
BAKE

PATIENT WALKS AGAIN
↓
DEFER
```

---

# PHASE 4 — IF SHADOW BAKES STILL CAUSE VISIBLE HITCHES

If the post-fix measurement shows that a single settled shadow bake still causes a clearly visible ~300 ms hitch:

Do not simply accept it.

Optimize it.

Consider, in this order:

1. Reduce caster count further.
2. Remove small/hidden casters.
3. Reduce shadow-map resolution.
4. Reduce the number of shadow updates.
5. Restrict shadow casters to visually important hero objects.
6. Consider a cheaper static/baked approximation for architectural shadows.

The patient should not experience a large hitch merely because they stopped scrolling.

---

# PHASE 5 — DO NOT OVER-OPTIMIZE BASED ON THE WRONG TEST

The aggressive 12-keypress stress test is useful for finding worst-case behavior.

But it is NOT representative of normal patient interaction.

Therefore evaluate both:

### Stress traversal

Fast traversal through the whole corridor.

### Natural traversal

Slow walking with pauses at each department.

The real UX target is:

> smooth natural exploration with cinematic pauses.

---

# PHASE 6 — INVESTIGATE THE PRE-EXISTING LOD STALL

You correctly identified that the existing LOD geometry rebuild contributes roughly 10 seconds of stall.

Now inspect it.

Do NOT blindly rewrite the entire LOD architecture.

First determine:

* which component triggers the rebuild
* what causes the rebuild
* whether it happens during camera movement
* whether it is synchronous
* whether it can be deferred
* whether geometry can be precomputed
* whether thresholds are too aggressive
* whether multiple departments rebuild simultaneously

The problem appears to be:

```text
camera crosses several LOD thresholds
        ↓
multiple geometry changes
        ↓
large synchronous work
        ↓
visible stalls
```

If that is confirmed, optimize the existing system rather than replacing it.

---

# PHASE 7 — FIX THE LOD STALL IF IT IS SAFE

If you can improve it without destabilizing the existing walkthrough, do so.

Preferred strategies:

### Option A — Prebuild

Prepare both LOD states ahead of time.

Then switch visibility rather than rebuilding geometry.

### Option B — Stagger

Do not rebuild five departments in the same frame.

Spread expensive operations over multiple frames.

### Option C — Predictive loading

Use the walkthrough progress.

When the camera approaches a department:

```text
approaching room
↓
prepare next LOD
↓
camera arrives
↓
already ready
```

This is especially appropriate because the camera follows a known path.

### Option D — Hysteresis

Prevent rapid LOD switching around thresholds.

---

# PHASE 8 — DO NOT BREAK THE WALKTHROUGH

The existing architecture is intentionally a cinematic journey.

Do not change:

* camera path
* scroll mechanics
* inertia
* walking sway
* department ordering
* room placement
* finale
* Continue behavior

Optimize behind the scenes.

---

# PHASE 9 — RETURN TO PHOTOREALISM

Once performance is stable enough, continue the visual objectives that remain unfinished.

Prioritize:

## 1. Solarium realism

This remains the most important visual weakness.

It must stop reading as a large white CG shell.

Ensure visible:

* upper shell
* lower base
* acrylic
* lamp array
* hinges
* ventilation
* control panel
* seals
* mechanical joins
* realistic internal structure

Use multiple materials.

---

## 2. Cast shadows

Major equipment should cast realistic soft shadows.

Especially:

* dental chair
* dental lamp
* laser machine
* treatment beds
* solarium
* trolleys

Do not enable expensive shadows on every tiny object.

---

## 3. Equipment material breakup

Large white devices need:

* molded ABS
* painted surfaces
* rubber
* metal
* glass
* different roughness values
* subtle large-scale variation

Avoid a single uniform white material.

---

## 4. Indirect light

Rooms need subtle:

* wall bounce
* floor bounce
* corner falloff
* local illumination
* object-to-object light interaction

Do this efficiently.

Do not introduce an expensive full GI solution unless absolutely necessary.

---

# PHASE 10 — PHOTOGRAPHIC QUALITY

Do NOT add more "effects" merely to make the scene impressive.

The realism should come from:

```text
Scale
+
Geometry
+
Materials
+
Lighting
+
Shadows
+
Reflections
+
Occlusion
+
Indirect light
```

Not:

```text
Bloom
+
Glow
+
Saturation
+
Vignette
```

---

# PHASE 11 — REALISTIC EQUIPMENT CHECK

At the actual patient camera height and distance:

### Dentistry

Must immediately read as a real dental operatory.

### Dermatology

Must read as a real dermatology examination room.

### Skincare

Must read as a premium medical aesthetics room.

### Solarium

Must immediately read as a commercial tanning bed.

### Laser

Must read as professional medical laser equipment.

Do not rely on labels to communicate the department.

---

# PHASE 12 — FINAL WALKTHROUGH TEST

Actually walk through the entire experience:

Reception
→ Dentistry
→ Dermatology
→ Skincare
→ Solarium
→ Laser
→ Finale

Do it twice:

### Pass 1

Natural slow exploration.

### Pass 2

Fast traversal stress test.

Check:

* frame hitches
* popping
* LOD transitions
* shadows appearing suddenly
* materials changing
* objects moving
* objects floating
* objects clipping
* lighting discontinuities

---

# PHASE 13 — REGRESSION TEST

Verify:

* patient login
* `/patient/welcome`
* cinematic walkthrough
* reverse scroll
* keyboard navigation
* department markers
* Continue
* password-change flow
* patient portal
* staff login bypass
* reduced-motion fallback
* no-WebGL fallback
* lazy-loaded 3D
* production build

Do not touch unrelated application systems.

---

# PHASE 14 — HONEST FINAL REPORT

At the end, report:

## Performance

Give REAL measurements only.

Include:

* shadow ON
* shadow OFF
* normal traversal
* stress traversal
* bake count
* stall duration

## Performance fixes

Explain exactly what changed.

## Visual improvements

Explain exactly what was improved.

## Remaining limitations

Be explicit.

Especially distinguish:

> verified

from:

> implemented but not directly verified.

---

# FINAL QUALITY BAR

Do not stop merely because TypeScript and ESLint pass.

The implementation is finished only when:

### VISUALLY

The patient feels like they are walking through a real luxury clinic.

### INTERACTIVELY

The camera feels like a person physically walking through the building.

### TECHNICALLY

The experience remains smooth and does not introduce major synchronous stalls.

### ARCHITECTURALLY

Existing patient/staff routing and password flows remain untouched.

### HONESTLY

Do not claim "photorealistic" unless the actual viewport supports that claim.

Continue from the current repository state.

**Inspect → measure → fix → visually inspect → optimize → regression test → report.**

Do not restart completed work.
