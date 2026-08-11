# Architect Alpaca look mechanics

## Natural motion

Architect Alpaca is a soft, full-body alpaca with physical eyes behind round glasses and a rigid graphite tablet held at the torso. The lower body, feet, and tablet grip are the stable anchor. The gaze leads with the whole eye globes and eyelids, followed by a restrained head and neck turn; the ears and forehead wool follow with a small soft-body lag. The glasses remain seated on the face and foreshorten with the head rather than sliding independently. The tablet stays attached to both paws, turns only slightly with the upper body, and lags the head a little so it remains a believable held prop.

## Cardinal pose families

- `000` up: pupils and eye globes clearly aim toward the top of the frame, the chin lifts, and the upper face/ears follow upward while the feet, lower torso, and tablet base stay anchored.
- `090` screen-right: nose tip, pupils, and head turn toward the right edge; the right cheek and side of the glasses become more visible, with the far cheek partly occluded. The tablet remains front-held with a slight rightward foreshortening.
- `180` down: chin and gaze aim toward the bottom of the frame; eyelids lower slightly, the forehead and glasses tilt down, and the tablet rises visually into the lower face without covering the eyes.
- `270` screen-left: nose tip, pupils, and head turn toward the left edge; the left cheek and side of the glasses become more visible, with the far cheek partly occluded. The tablet remains attached and foreshortens slightly leftward.

## Motion budget

Each 22.5-degree step changes the same parts by a similar visual amount: eye direction and eyelids move first, head/neck follows, then ears and forehead wool follow softly. Feet, lower torso, hoodie hem, and the lower tablet grip remain nearly fixed. No step uses whole-sprite rotation, large body tilt, sudden scale change, prop teleportation, or a larger bend than its neighboring steps. The ordered loop must progress smoothly `000 -> 090 -> 180 -> 270 -> 000` through the two generated rows.
