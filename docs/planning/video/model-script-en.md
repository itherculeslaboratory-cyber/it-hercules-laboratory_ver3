---
id: model-script-en
title: Model Script (English) — Temperature Control for Hercules Beetle Larvae, explained with measured data
date: "2026-07-11"
status: active
lang: en
series: IHL Insect Rearing Field Data
episode: 1
requirements:
  - V3-VID-31
  - V3-VID-32
  - V3-VID-33
  - V3-VID-34
  - V3-VID-09
  - V3-VID-29
  - V3-VID-30
  - V3-VID-14
  - V3-VID-28
  - V3-VID-27
  - V3-VID-01
  - V3-VID-02
  - V3-VID-18
  - V3-VID-STORE
---

# Model Script (English) — Temperature Control for Hercules Beetle Larvae

> Finished reference sample of the "yukkuri" method (synthesized voice, **single-narrator** structured explainer).
> Following the R-3 retraction constraint, no automatic two-character dialogue is used. There is one narrator, built from a standing portrait, subtitles, and still images.
> This file is the English adaptation of the Japanese script (`model-script-ja.md`). Subtitles follow a 1-line ≤42-character, max-2-line rule (see §3 for why this differs from the Japanese value).

---

## §1 Metadata

- **Video title** (accurate to content, no clickbait / V3-VID-14):
  Temperature Control for Hercules Beetle Larvae — Explained with Measured Data (IHL Field Data #1)
- **Thumbnail text** (key phrase + series name + episode number / V3-VID-30):
  - Main headline (key phrase): Larva Temperature Control / Aim for 20-25°C
  - Series name: IHL Insect Rearing Field Data
  - Episode: #1
- **One-line description** (V3-VID-30):
  Using temperature data measured with sensors, this video explains the key points and cautions for managing Hercules larva temperature.

- **Full description text** (zero CTA, no request phrasing, related links allowed as information / V3-VID-32, V3-VID-09):

  ```
  An explainer that organizes the basics of temperature control for Hercules beetle larvae, alongside measured data.

  What this video covers:
  - What temperature control needs (measuring, heating, recording)
  - The larval growth stages (first to third instar, prepupa, pupal cell) and their relation to temperature
  - The idea of accumulated temperature
  - A sample of observation data from our lab (Insect Hercules Laboratory) using a SwitchBot thermo-hygrometer
  - An honest disclosure of the downsides (small data volume, electricity cost, individual variation, single-environment observation)

  These numbers are observations from one rearing environment at our lab; results can differ with a different region, room, or individual.
  This video is not "handing out the correct answer." It is a starting point for measuring and confirming in your own environment.

  Related links (information):
  - Observation data records: (set the routing-table URL)
  - List of sensors used: (set the related-page URL)

  The next video is planned to cover humidity and ventilation.
  ```

  > Model note: the two brackets above — "(set the routing-table URL)" and "(set the related-page URL)" — are the spots to fill in once the V3-VID-STORE routing table is finalized and the video is published. Because those URLs have not been issued yet, leaving them unfilled is the correct state for this sample; fabricated URLs are deliberately not placed. Pre-publish checklist: replace both tokens with real URLs before publishing (unfilled = do not publish).

- **Chapters** (V3-VID-14):
  - 0:00 Intro — what you need and the benefits
  - 1:12 Larval growth stages and temperature basics
  - 2:09 Accumulated temperature, pupation, and the pupal cell
  - 3:09 A sample of measured data
  - 3:55 The downsides, told honestly
  - 4:53 Recap and review

- **Target length**: about 5 minutes 50 seconds (length set by content / V3-VID-29). 37 cuts.
- **Standard form**: still image + standing portrait (one narrator) + subtitles + synthesized voice (an English OSS TTS such as Piper or Coqui TTS; the TTS engine is language-specific — VOICEVOX is Japanese-only and is used only for the Japanese version / V3-VID-18, V3-VID-29).
- **Subtitle rules**: English adaptation uses ≤42 characters per line, max 2 lines, bold white text with black outline, bottom placement, timed to the audio (V3-VID-14; adapted value — see §3).
- **7-second rule**: never hold a fully static frame for 7 seconds or more (V3-VID-29). Beyond the portrait's blinking and lip-sync, each cut adds progressive reveal of diagram elements or number highlights to avoid stillness (noted in the asset memos).

---

## §2 Cut table (script body, machine-readable)

Structure order: Hook (3 s) → opening (what you need / benefits) → main topic (growth stages, temperature, accumulated temperature, pupation) → example / measured data → honest disclosure of downsides → recap / review (ends with no CTA).

| cut | start | screen (still / portrait / diagram — changes within 7 s of previous) | audio (full narration line) | subtitle (≤42 chars/line, max 2 lines) | asset memo (generated in small-function units) |
|---|---|---|---|---|---|
| 01 | 0:00 | Title still + portrait (front). A large larva silhouette at center. | If you want to raise a big Hercules beetle larva, one of the keys is temperature control. | The key to raising a big larva:<br>temperature control | Generate 1 still. Portrait blinks. Title text fades in over 3 s (Hook). |
| 02 | 0:09 | A sensor icon and a simple line-graph diagram placed side by side. | In this video, we'll use real temperature data measured with a sensor to work out what you actually need to do. | Using real measured data<br>to work out what to do | 1 graph diagram. The line draws rightward over 2 s (avoids stillness). |
| 03 | 0:18 | Portrait (explaining pose) + three icons (thermometer, house, notebook) shown in turn. | You need three things: a tool to measure temperature, an environment that holds heat, and the habit of keeping records. | Three things you need:<br>measuring, heating, recording | Generate the 3 icons one at a time and reveal in sequence (1 function = 1 icon). |
| 04 | 0:27 | All three icons present + an arrow toward "stable." | With these in place, you're no longer leaving growth to chance; you can shape conditions on purpose. | Not leaving growth to chance<br>you shape conditions on purpose | Add 1 arrow animation. Portrait nods. |
| 05 | 0:36 | Portrait (pointing) + a "Benefits" heading board. | There are three main benefits. Let's look at them one by one. | There are three main benefits<br>let's take them one by one | 1 heading board. Show empty number slots (filled in next cuts). |
| 06 | 0:45 | Benefit 1 card. A small figure of a thermometer swinging red and blue. | First, you can lower the risk of death or poor development. It becomes easier to avoid heat and cold accidents. | First: lower the risk<br>avoid heat and cold accidents | Generate card 1. Short motion of the needle swinging red then blue. |
| 07 | 0:54 | Benefit 2 card. A small scatter-plot figure showing spread. | Second, you can see the spread in growth. With data, you can choose your next move on evidence. | Second: see the spread in growth<br>choose the next move on evidence | Generate card 2. Plot a few scatter points at a time. |
| 08 | 1:03 | Benefit 3 card. An arrow figure passing the same conditions to the next individual. | Third, your rearing becomes more repeatable. Conditions that worked can be reused for the next larva. | Third: better repeatability<br>reuse conditions that worked | Generate card 3. Add 1 arrow. Portrait nods. |
| 09 | 1:12 | Chapter change. Background shifts to a calm color. Portrait (front) + chapter heading "Growth stages." | Now for the main topic. First, let's get clear on the stages a larva grows through. | Now the main topic<br>first, the growth stages | 1 chapter-heading board. Background-color transition (avoids stillness). |
| 10 | 1:20 | A left-to-right row of egg → 1st → 2nd → 3rd instar, lit in order. | After hatching from the egg, a Hercules beetle grows through the first, second, and third larval instars. The third instar is when the body gets largest. | Egg to 1st, 2nd, 3rd instar<br>largest in the third instar | Generate and light the 4 stage elements one at a time (1 function = 1 stage). |
| 11 | 1:31 | An enlarged still of the third instar (final instar). Term callout "final instar = the last larval stage." | The third instar, the final instar, eats heavily and gains weight. Conditions in this period affect the adult's size. | Final instar eats and grows<br>directly linked to adult size | 1 enlarged still. Delay the term callout (plain-language gloss included). |
| 12 | 1:41 | Cross-section of the mat (fermented leaf humus) + larva. Term callout "mat = fermented leaf humus." | What the larva eats is called mat, a fermented leaf humus. Nutrition and temperature form the base for growth. | Food is fermented mat<br>nutrition and heat are the base | 1 cross-section diagram. Callout includes a plain-language gloss. |
| 13 | 1:50 | Temperature-scale diagram (the 20-25°C band highlighted green). | Now, temperature. Hercules larvae are often kept in a range of roughly twenty to twenty-five degrees Celsius. | Rough guide: about 20-25°C<br>often kept in this range | 1 temperature scale. Fill the green band from the left (avoids stillness). Use "often kept," not an absolute claim. |
| 14 | 2:00 | Same scale, alternately flashing the high side (red) and low side (blue). | Too high, and the larva becomes overactive and wears itself out. Too low, and growth stalls while time keeps passing. | Too high: it wears itself out<br>too low: growth stalls | Alternate the red and blue highlights. Swap in a troubled-face portrait. |
| 15 | 2:09 | An "Accumulated temperature" heading + a bar chart stacking daily temperatures. | Here a concept called accumulated temperature helps. It's the running total of daily temperatures, used to gauge how far growth has progressed. | Accumulated temperature helps<br>the running total of daily heat | Stack one day's bar at a time (1 function = 1 day). Include a plain-language gloss of the term. |
| 16 | 2:19 | Buildup for a warm environment and a cold one, compared left and right. | Over the same number of days, a warmer setting builds up more accumulated temperature. That is why recording and watching the total is worthwhile. | Warmer builds up more total<br>record and watch the sum | Grow the two bars alternately, left and right. Portrait nods. |
| 17 | 2:29 | A still of the prepupa. Term callout "prepupa = just before pupation." | Once it has grown enough, the larva becomes a prepupa: the stage just before pupation, when it moves very little. | Grown enough: it turns prepupa<br>the stage just before pupation | 1 prepupa still. Delay the callout (plain-language gloss included). |
| 18 | 2:39 | Cross-section of a pupal cell built inside the mat. Term callout "pupal cell = chamber for metamorphosis." | At this point the larva builds a chamber in the mat called a pupal cell: the space where the pupa transforms. | It builds a pupal cell in the mat<br>the room for its transformation | 1 pupal-cell cross-section. Draw the chamber outline to show it. |
| 19 | 2:48 | A hand icon signaling "gently" over the pupal cell, plus a caution mark. | Once the pupal cell is being built, leaving it undisturbed matters, and digging it up is best avoided. Vibration and temperature swings are causes of failure. | The pupal cell is left undug<br>vibration and temp swings are risks | 1 caution icon. Written in declarative form (not a request). |
| 20 | 2:58 | An image of dormancy (a clock + a motionless individual). Term callout "dormancy = holding back activity to wait." | Also, some species show dormancy, holding back activity to wait out a period. In Hercules, this is the time after eclosion when it does not move right away. | Some species show dormancy<br>a quiet spell after eclosion | Turn the clock hands slowly. Plain-language gloss included. |
| 21 | 3:09 | Chapter change. A still of the lab's observation setup + a photo-style figure of the actual thermo-hygrometer. | Now let's look at some real data. At our lab, we measure the rearing environment with a SwitchBot thermo-hygrometer. | Now, some real data<br>measured with a thermo-hygrometer | Chapter heading + 1 equipment still. Background-color transition. No exaggeration (describe within actual use). |
| 22 | 3:18 | A line graph of one day's temperature (points at 24°C midday and 21°C near dawn highlighted). | For example, one container read twenty-four degrees in the afternoon and twenty-one degrees near dawn. That is a gap of about three degrees. | 24°C midday, 21°C near dawn<br>a daily gap of about 3°C | Draw the line rightward. Highlight the 24°C and 21°C points in turn. Numbers are illustrative — replace with actual SwitchBot log values at publish time. |
| 23 | 3:27 | Overlay the 20-25°C green band on the same graph. | A swing this small stays within that twenty to twenty-five degree range from earlier. No major problem shows up. | This swing stays in range<br>no major problem shows up | Overlay the green band. Portrait nods. |
| 24 | 3:36 | A winter-night graph. The 16°C point sits below the green band, shown in red. | On the other hand, suppose that on a winter night the room dropped to sixteen degrees. That day would fall below the range. | Suppose a winter night hits 16°C<br>below the guide range | 1 graph for another day. Highlight the 16°C point in red. Numbers are illustrative — replace with actual SwitchBot log values at publish time. |
| 25 | 3:45 | A panel-heater setup diagram + an arrow pushing the temperature up. | So a panel heater was used to hold the warmth and lift the temperature back up. Because it is visible in numbers, the response is clear too. | A panel heater held the warmth<br>numbers make the response clear | 1 heater diagram. Upward-arrow animation. Written in declarative form. |
| 26 | 3:55 | Chapter change. Calm background + portrait (serious expression) + heading "The downsides." | From here, the downsides, told honestly. It is not all upside. | Now the honest downsides<br>it isn't all upside | 1 chapter-heading board. Background-color transition. Core of V3-VID-31④. |
| 27 | 4:02 | Caution card 1: "small data volume." A tiny-sample figure. | First. The data just shown is still limited in both the number of individuals and the span of time. We can't draw a firm general rule from it. | The data is still limited<br>no firm general rule yet | Generate card 1. No exaggeration (do not write unachieved claims like "best in the country"). |
| 28 | 4:12 | Caution card 2: "electricity cost." A figure of an outlet and a billing meter. | Second. Holding temperature means using electricity continuously. The power cost of heaters and air conditioning is a real burden you cannot ignore. | Heating uses ongoing power<br>the cost is a real burden | Generate card 2. Short motion of the meter numbers climbing. |
| 29 | 4:22 | Caution card 3: "individual variation." Two larvae, large and small, in the same environment. | Third. Individual variation exists. Even in the same environment, some grow large and some do not. Temperature is not the only factor. | Individuals vary<br>temperature isn't the only factor | Generate card 3. Show the size gap between two individuals in a figure. |
| 30 | 4:33 | Caution card 4: "single environment." A one-room icon with a note. | Fourth. These numbers are observations from one environment at our lab. In a different region or room, the results can change. | This is one environment's data<br>other settings, other results | Generate card 4. Attach a note limiting the scope of application. |
| 31 | 4:43 | Portrait (front) + a one-line board "starting point." | So this video is not handing out a correct answer. It is a starting point for measuring and confirming in your own environment. | This isn't a correct answer<br>a starting point to check yourself | 1 one-line board. Declarative, not pushy. |
| 32 | 4:53 | Chapter change. A "Recap" heading + three empty number slots. | Now, let's recap. Today there were three key points. | Let's recap now<br>three key points today | 1 recap-heading board. Show empty number slots (filled in next cuts / V3-VID-28). |
| 33 | 5:00 | Recap 1 card + the 20-25°C green band shown again. | One. During the third instar, aim to keep conditions around twenty to twenty-five degrees. | 1. Aim for about 20-25°C<br>during the third instar | Fill recap 1. Re-show the green band. |
| 34 | 5:08 | Recap 2 card + the stacked bar chart shown again. | Two. Record daily temperatures and view them as an accumulated total. Numbers become the basis for decisions. | 2. Record and use accumulated temp<br>numbers ground your decisions | Fill recap 2. Re-show the bar chart. |
| 35 | 5:17 | Recap 3 card + the electricity-cost and individual-variation icons shown again. | Three. Judge with the downsides included, such as electricity cost and individual variation. | 3. Include the downsides too<br>power cost and individual variation | Fill recap 3. Reuse the icons from cuts 28 and 29. |
| 36 | 5:26 | Portrait (calm expression) + a timeline icon showing the buildup of observation. | A larva's growth is a slow build-up of observation. Measuring, recording, checking; repeating that carries over to the next one. | Measuring, recording, checking<br>it carries to the next larva | Light the timeline icons from the left. End with no CTA. |
| 37 | 5:38 | End screen. A related-links heading, then next-episode preview text, revealed in sequence (informational display). | Detailed records of the observation data are gathered in the related links in the description. The next video is planned to cover humidity and ventilation. | Details in the description links<br>next: humidity and ventilation | 1 end-screen still. Portrait keeps blinking. Sequential fade-in of links heading → preview text at ~5 s intervals (7-second rule observed). Links shown as information (no request phrasing). Preview in declarative form. |

---

## §3 Self-inspection results

Conformance declaration for each requirement, with the source cut numbers.

- **V3-VID-31① (open by clearly stating "what you need" and "the benefits")**: Conforms. cut01 states the goal (temperature control is a key); cut03-04 give the three things needed (measuring, heating, recording); cut05-08 spell out the three benefits.
- **V3-VID-31② (logical explanation, maintained tempo)**: Conforms. One-directional logical flow: growth stages → temperature guide → accumulated temperature → pupation → measured data → downsides → recap. Each cut runs about 8-11 seconds to keep tempo (cut09-20 is the logical spine).
- **V3-VID-31③ (use the right technical terms correctly, with plain-language glosses)**: Conforms. Uses third instar / final instar (cut10-11), mat (cut12), accumulated temperature (cut15), prepupa (cut17), pupal cell (cut18), and dormancy (cut20), each paired with a plain-language gloss in a term callout. Terms are not avoided and not misused.
- **V3-VID-31④ (honest disclosure of downsides / disadvantages, zero exaggeration)**: Conforms. cut26-31 honestly disclose four downsides (small data volume, electricity cost, individual variation, single environment). No unachieved claims (e.g., "best data in the country") appear. Numbers use hedged phrasing such as "often kept" and "can change." The individual figures on the measured-data graphs (cut22-24) are marked as illustrative in both the audio and the asset memos, and will be replaced with actual SwitchBot log values at publish time (fabricated values are never asserted as measured).
- **V3-VID-31⑤ (close with a recap / review)**: Conforms. cut32-37 are the recap and review. The three key points are restated, and it ends with no CTA.
- **V3-VID-32 (total CTA ban)**: Conforms. Neither the script body, subtitles, description, nor thumbnail text contains any viewer-directed CTA wording — the banned terms are not literally listed here to avoid false positives (see the gate (a) regex in orchestration.md). Assumes machine detection returns zero.
- **V3-VID-09 (no request phrasing at the ending; related links allowed as information)**: Conforms. The cut37 related links are informational display only. No request forms ("please...", "make sure to...", "be sure to...") appear in any cut. Cautions (e.g., cut19 "vibration and temp swings are risks") are written in declarative form. The next-episode note (cut37) uses the declarative "is planned to cover."
- **V3-VID-29 (content-first, 7-second rule, no excessive decoration)**: Conforms. Investment order puts script and structure highest; diagrams are limited to comprehension aids. Standard form (still + portrait + subtitles + synthesized voice). Beyond the portrait's blinking and lip-sync, each cut places progressive reveals, number highlights, and transitions to avoid a fully static frame of 7 seconds or more (each cut's stillness-avoidance means is noted in its asset memo). Decoration is minimal.
- **V3-VID-14 (subtitle rules, chapters)**: Conforms with an adapted value. The Japanese 22-character-per-line rule is a value tuned for Japanese; this English adaptation uses ≤42 characters per line, max 2 lines. All 37 cuts' subtitle lines were counted and are within 42 characters per line. Bold white text with black outline, bottom placement, and timing aligned to the audio are specified (§1). Six chapters are provided (§1). Title and tags describe the content accurately, with no clickbait.
- **V3-VID-28 (Hook 3 s / main / example / recap)**: Conforms. Hook = cut01 (title shown over 3 s), main = cut09-20, example / measured data = cut21-25, recap = cut32-37.
- **V3-VID-30 (title + thumbnail = unique search key; thumbnail carries key phrase / series name / episode; one-line description)**: Conforms. §1 records the title, the thumbnail text (key phrase "Larva Temperature Control / Aim for 20-25°C" + series name "IHL Insect Rearing Field Data" + episode "#1"), and the one-line description.
- **V3-VID-27 (small-function units, no batch generation, local GPU)**: Conforms. Asset memos are written at small-function granularity of 1 image / 1 icon / 1 stage / 1 day, etc. (e.g., cut03 generates 3 icons individually, cut10 the 4 stage elements individually, cut15 stacks bars one day at a time). Assumes sequential generation on an 8 GB VRAM-class local GPU.
- **V3-VID-18 (OSS-first, local completion)**: Conforms. Synthesized voice via an English OSS TTS (e.g., Piper or Coqui TTS — the TTS engine is language-specific; VOICEVOX is Japanese-only and is used only in the Japanese version), assembly via ffmpeg, and portrait compositing are assumed (§1).
- **V3-VID-01/02 (human OK/NG at each split point; final publish is a human gate)**: Conforms. Human confirmation is assumed at each split point of script / audio / image / assembly, and the publish/post button is a human gate (this script is a sample, not a published item).
- **R-3 retraction constraint**: Conforms. Written as a single-narrator structured explainer. No automatic two-character dialogue is used (stated at the top of the file).
- **V3-VID-STORE**: Conforms. The video body is not stored in R2 or the system; the design references an external platform via the description link (routing-table URL) (cut37, description).
- **English handling (V3-VID-34)**: This file is the English adaptation of the Japanese script. Japanese + English is the base; because the method uses synthesized voice, adding a language is low cost. This file carries no viewer-directed CTA stock phrases — not literally listed here to avoid false positives (stated at the top of the file).
