# Blocking (`blocking`)

**Source:** buckler reactive skill; it is deliberately not extractable. **Activation:** reactive, zero direct spell cost; successful blocks spend the buckler's calculated stamina cost and start cooldown. **Effect:** it prevents `min(incomingDamage, Strength)` under the shared chance, resource, and mitigation rules. Base cooldown is 1 second; a Return buckler divides it by equipped-main-hand attacks per second.
