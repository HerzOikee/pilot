# Pilot Training

Training apps for the pilot school entrance exam. Play them at
**https://herzoikee.github.io/pilot/**, or open `index.html` in a browser
(Chrome, Edge or Firefox). No installation needed.

Each app lives in its own folder, and `index.html` at the top links to them.

## Bird Game (`bird-game/`)

A dot wanders slowly around the screen. Use a joystick to keep the dot
inside the circle while keeping the circle's "wings" level as they lean
randomly from side to side. A speed vector sticks up or down from the right
wing tip as the speed wanders. Use the throttle to keep it hidden.

- **Joystick:** plug it in and press any button so the browser detects it.
  The stick moves the circle. Pick which axis tilts the wings in the menu.
  The live axis bars show which axis is which. The speed uses axis 6
  (the throttle) by default.
- **Wing sensitivity:** use the slider in the menu to match how quickly the
  wings react in the real test.
- **Keyboard:** arrow keys move the circle, `Q` / `E` tilt the wings,
  `W` / `S` change the speed.
- `Esc` pauses.

When a round ends you see the percentage of time the dot was inside the
circle, the wings were level (within ±5°) and the speed vector was hidden.
Recent results are saved in your browser.

## 4-in-1 Exercise (`four-in-one/`)

Four tasks at once. Each one can be turned off in the menu to practise it
alone.

- **Balance:** a two-coloured square stands on one corner and keeps tipping
  to the side, turning around its centre. Move the mouse left or right (the
  bar below the square shows where) towards the side it tips to, to keep it
  upright.
- **Towers:** one red square at a time runs down a tower on either side.
  Sometimes it turns towards the middle at the halfway point. Press `Space`
  when it does.
- **Colours:** every now and then a colour pattern, for example "2 red,
  1 blue", is shown for 8 seconds. Press `Space` when the row of six squares
  at the top has exactly that many of those colours, in any order.
- **Numbers:** a voice slowly reads four digits in English, then four more.
  Press `Space` if the second sequence is the first one reversed.

All three tasks use `Space`. One press answers everything that is open at
that moment. The voice uses the browser's built-in speech.
