# LeadFlow Quote Form — Design Brainstorm

## Design Approaches

<response>
<text>
### Approach A: Warm Coral Hospitality

**Design Movement:** Contemporary Service Design — inspired by modern home services brands (think Handy, Thumbtack) with a warm, approachable human touch.

**Core Principles:**
- Warmth through coral/salmon tones that feel inviting, not clinical
- Generous whitespace that reduces cognitive load and builds trust
- Soft depth via subtle card shadows and light warm-tinted backgrounds
- Clear visual hierarchy that guides the eye from headline → fields → CTA

**Color Philosophy:**
- Primary coral: `#E8603C` (energetic, action-oriented)
- Soft background: `#FFF8F5` (warm off-white, like warm sunlight)
- Input borders: `#F0A090` (muted coral, visible but not harsh)
- Text: `#2D2D2D` (near-black, warm undertone)
- Stars: `#F5A623` (amber gold, trustworthy)

**Layout Paradigm:** Single-column card with 2-column field grid. The card floats on a warm tinted background with a subtle drop shadow. Max-width ~680px for ideal embed width.

**Signature Elements:**
- Coral gradient CTA button with subtle shine on hover
- Star rating row with pulsing entrance animation
- Input fields with warm-tinted background (`#FFF0EC`) and coral focus ring

**Interaction Philosophy:** Every interaction should feel warm and encouraging — fields glow coral on focus, the CTA button lifts on hover, success state reveals a checkmark with a gentle bounce.

**Animation:**
- Form entrance: stagger-fade each field group from bottom (60ms delay each)
- Input focus: border color transition 200ms ease
- CTA hover: translateY(-2px) + shadow deepens
- Submit: button morphs to spinner, then success checkmark

**Typography System:**
- Headline: `Playfair Display` Bold 700 — elegant, premium
- Subheading/body: `DM Sans` Regular/Medium — clean, modern, readable
- Labels/inputs: `DM Sans` 14px Regular
</text>
<probability>0.08</probability>
</response>

<response>
<text>
### Approach B: Clean Precision with Coral Accents

**Design Movement:** Swiss Modernism meets Warm Service — grid-precise layout with a warm coral accent system.

**Core Principles:**
- Strict grid discipline with deliberate asymmetry in the header area
- Coral used sparingly as a high-contrast accent against white
- Typography-led hierarchy — size and weight carry more weight than color
- Form feels like a premium intake tool, not a generic web form

**Color Philosophy:**
- White card on a very light gray background
- Coral accent only on borders, CTA, and focus states
- Dark charcoal text for authority

**Layout Paradigm:** Left-aligned header text with a coral accent bar, fields in a clean 2-column grid.

**Signature Elements:**
- Thin coral left-border accent on the card header
- Monospace field labels that feel precise
- Minimal star rating with number badge

**Interaction Philosophy:** Precise and efficient — no unnecessary animation, just clean state transitions.

**Animation:** Subtle fade-in on load, field border transitions only.

**Typography System:**
- Headline: `Sora` Bold
- Body: `Inter` Regular
</text>
<probability>0.06</probability>
</response>

<response>
<text>
### Approach C: Soft Gradient Warmth

**Design Movement:** Neomorphic Warmth — soft shadows, warm gradients, and tactile depth.

**Core Principles:**
- Everything feels soft and touchable
- Gradient backgrounds from warm cream to light coral
- Fields appear inset into the card surface
- Rounded corners throughout (16px+)

**Color Philosophy:**
- Background gradient: `#FFF5F0` to `#FFE8E0`
- Inset fields with inner shadow
- Coral CTA with gradient

**Layout Paradigm:** Centered card with generous padding, fields with inset shadow effect.

**Signature Elements:**
- Inset input fields (neomorphic style)
- Gradient card background
- Floating label animation

**Interaction Philosophy:** Tactile and soft — everything has a physical quality.

**Animation:** Soft press effect on CTA, floating labels on focus.

**Typography System:**
- Headline: `Nunito` ExtraBold
- Body: `Nunito Sans` Regular
</text>
<probability>0.07</probability>
</response>

---

## Selected Approach: **Approach A — Warm Coral Hospitality**

This approach most closely matches the provided design inspiration while elevating it with:
- Playfair Display for the headline (premium feel)
- DM Sans for clean, readable body text
- Staggered entrance animations for polish
- Warm tinted input backgrounds matching the coral theme
- Embeddable card design that works seamlessly on any website
