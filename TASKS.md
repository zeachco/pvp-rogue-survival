# Things to fix

## Here is a list of TODOs to address:

- [ ] when displaying a message about what the opponent sent, the color is green, if it's a foe, it should be red for that message type as well

- [ ] when losing focus on the webapp, the enemies coumpoun and all appear at the same time, it should not skip the creep debouncing

- [ ] when a player dies a message log is sent to all participant of the realm, if it the killing blow was by a creep owned by a player, it also shows it in the chat log

- [ ] if a creep is sent in a realm with the healing skill, it heals all creeps around the equiped creep

- [ ] now announce each wave in the chat as yellow text and at the start of a realm game, show the players that joined also as system messages

- [ ] when hero has the passive skill "blocking" it reflects on the char stats as block change %

- [ ] Attraction passive, each level augment mana consumption without scaling anything else, add 1% magic find and 1% gold find per level, also augment attraction speed slightly up to lvl 99 which is 4 times as fast

- [ ] Creeps equipped with player sent items may possess skills from those items. When a creep has the **healing** skill (granted by Rare/Epic maces or extracted as a universal skill), it automatically casts healing when below 75% HP and has sufficient mana, exactly like the hero's auto_cast logic. The heal restores its level_scaled fraction of current HP plus `5% * maxHP` and `5% * maxHP * currentRage / maxRage`, costs 2 mana, and has a cooldown that scales from 15s at level 1 to 1s at level 99 (independent of attributes and cooldown reduction). The heal affects the creep itself and all allied creeps within 300 pixels. Healing creates green floating combat text and rising green mote spell effects on each affected creep.

- [ ] Wave starts do not show a banner or routine notification; the fixed header's current_wave value is the persistent indication. Each wave is announced in the chat log as a yellow system message showing the wave number and mode. When a competitive realm forms, system messages announce each participant joining the realm.

- [ ] _balance changes_: Item requirements penality cannot be higher than 90% so if an item gives 20 strength, and requires a level 99, even a just level 1 the item should give 2 strength (10% of 20)

- [ ] _balance changes:_ When a normal creep is spawned, if it's not a champion, boss or player sent creep, all the extra spirit is converted into strength leaving 1 spirit only. ie: a creep spawning with 10 on all stats would end up having 1 spirit and 19 strength instead. This ensures they don't have too much regen

- [ ] _bug fixing_: When ressources are updated, make sure all items upgrade buttons are updated as well
