# How to work this file

For each categories under, chose one easy to implement task, do it and remove that from the list once confirmed by the user that it's done. When you're done, commit the change using commit semantics such as `balance(spell): blizzard area rescaled per level` or `perf(shadow): improved shadow performance for creeps\n\nreduced mask resolution for repeating patterns`

## Fixes

- when disconnected from a server, show in the logs that the servers closed the connexion on their side
- in options panel, the settings for lights, make the `all` the default and make it pre selected by the radio button, then store to the local storage the value, not on the player

## Balance

- When a weapon has a change to trigger a spell on hit, it's for every unit hit, if the weapon hits 3 units, it x3 the chances (capped at 100%)

## UX

- moves effects on hero over the hp bar instead of the lvl circle and add tooltips for each that display what they do (`bleed, 23dmg/sec, X secs` or `Reflective surge, doule returned damage and provide base block of x %, X secs`)
