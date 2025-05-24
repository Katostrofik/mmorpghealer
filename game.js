document.addEventListener('DOMContentLoaded', () => {
    // DOM Elements
    const partyFramesContainer = document.getElementById('party-frames');
    const abilityButtonsContainer = document.getElementById('ability-buttons');
    const manaValueDisplay = document.getElementById('mana-value');
    const maxManaValueDisplay = document.getElementById('max-mana-value');
    const combatLog = document.getElementById('combat-log');
    const gameContainer = document.getElementById('game-container');
    const metaHub = document.getElementById('meta-progression-hub');
    const startNewRunButton = document.getElementById('start-new-run-button');
    const runsCompletedDisplay = document.getElementById('runs-completed');
    const enemyDisplayArea = document.getElementById('enemy-display-clickable-area');
    const castingBarContainer = document.getElementById('casting-bar-container');
    const castingSpellName = document.getElementById('casting-spell-name');
    const castingBarProgress = document.getElementById('casting-bar-progress');
    const friendlyTargetNameDisplay = document.getElementById('friendly-target-name');
    const friendlyTargetHealthDisplay = document.getElementById('friendly-target-health');
    const friendlyTargetHealthWrapper = friendlyTargetNameDisplay.closest('.target-frame')?.querySelector('.health-bar-wrapper');
    const enemyTargetNameDisplay = document.getElementById('enemy-target-name');
    const enemyTargetHealthDisplay = document.getElementById('enemy-target-health');
    const enemyTargetHealthWrapper = enemyTargetNameDisplay.closest('.target-frame')?.querySelector('.health-bar-wrapper');

    // Game State
    let runsCompleted = 0; let selectedFriendlyTarget = null; let selectedEnemyTarget = null;
    let party = []; let healer; let currentEncounter = null;
    let gameLoopInterval; let uiUpdateInterval; let hazardInterval; let addSpawnInterval;
    let encounterActive = false; let isCasting = false; let castTimeoutId = null;
    let totalXPEarnedThisRun = 0;

    const HEAL_THREAT_MODIFIER = 0.5; const DAMAGE_THREAT_MODIFIER = 1.0; const SMITE_THREAT_MODIFIER = 0.8;
    const FIRE_DAMAGE_INTERVAL = 7000; const FIRE_DAMAGE_AMOUNT = 15;
    const ADD_SPAWN_CHANCE_PER_TICK = 0.005; // Adjusted during gameTick

    const healerClasses = {
        Cleric: {
            name: "Cleric", maxMana: 100,
            abilities: [
                { id: "holy_light", name: "Holy Light", cost: 15, castTime: 1.5, cooldown: 0, type: 'friendly', targetType: 'single', icon: 'fa-solid fa-hand-holding-medical', sound: 'heal_direct',
                    effect: function(target, caster) { 
                        const healAmount = Math.floor(Math.random() * 15) + 25 + Math.floor(caster.stats.spellPower * 0.5 || 0);
                        target.heal(healAmount, caster.name, "Holy Light");
                        if (currentEncounter?.getActiveEnemies().length > 0) currentEncounter.getActiveEnemies().forEach(enemy => caster.generateThreat(healAmount * HEAL_THREAT_MODIFIER, enemy));
                    }
                },
                { id: "renewing_prayer", name: "Renewing Prayer", cost: 10, castTime: 0, cooldown: 6, type: 'friendly', targetType: 'single', icon: 'fa-solid fa-seedling', sound: 'heal_hot',
                    effect: function(target, caster) {
                        const healPerTick = Math.floor(Math.random() * 3) + 6 + Math.floor(caster.stats.spellPower * 0.1 || 0);
                        const duration = 9; const ticks = 3;
                        target.applyEffect({
                            name: "Renewing Prayer", type: "hot", icon: 'fa-solid fa-seedling', duration: duration * 1000, healPerTick: healPerTick,
                            ticksRemaining: ticks, tickInterval: (duration / ticks) * 1000, casterName: caster.name,
                            onTick: (effectTarget) => {
                                effectTarget.heal(healPerTick, caster.name, "Renewing Prayer Tick");
                                if (currentEncounter?.getActiveEnemies().length > 0) currentEncounter.getActiveEnemies().forEach(enemy => caster.generateThreat(healPerTick * HEAL_THREAT_MODIFIER * 0.3, enemy));
                            },
                            onExpire: (effectTarget) => logCombat(`Renewing Prayer fades from ${effectTarget.name}.`)
                        });
                        if (currentEncounter?.getActiveEnemies().length > 0) currentEncounter.getActiveEnemies().forEach(enemy => caster.generateThreat(healPerTick * ticks * HEAL_THREAT_MODIFIER * 0.15, enemy));
                        logCombat(`${caster.name} casts Renewing Prayer on ${target.name}.`);
                    }
                },
                { id: "divine_shield", name: "Divine Shield", cost: 25, castTime: 0.5, cooldown: 30, type: 'friendly', targetType: 'single', icon: 'fa-solid fa-shield-heart', sound: 'buff_shield',
                    effect: function(target, caster) {
                        const shieldAmount = 50 + Math.floor(caster.maxMana * 0.1) + Math.floor(caster.stats.spellPower * 0.3 || 0);
                        const duration = 8;
                        target.applyEffect({
                            name: "Divine Shield", type: "shield", icon: 'fa-solid fa-shield-heart', duration: duration * 1000,
                            shieldValue: shieldAmount, casterName: caster.name,
                            onExpire: (effectTarget) => logCombat(`Divine Shield fades from ${effectTarget.name}.`)
                        });
                        if (currentEncounter?.getActiveEnemies().length > 0) currentEncounter.getActiveEnemies().forEach(enemy => caster.generateThreat(shieldAmount * HEAL_THREAT_MODIFIER * 0.2, enemy));
                        logCombat(`${caster.name} shields ${target.name} for ${shieldAmount.toFixed(0)}.`);
                    }
                },
                { id: "smite", name: "Smite", cost: 12, castTime: 1.0, cooldown: 3, type: 'offensive', targetType: 'single', icon: 'fa-solid fa-bolt-lightning', sound: 'damage_magic',
                    effect: function(target, caster) { 
                        const damageAmount = Math.floor(Math.random() * 10) + 20 + Math.floor(caster.stats.spellPower * 0.4 || 0);
                        target.takeDamageFromPlayer(damageAmount, caster, "Smite"); 
                        caster.generateThreat(damageAmount * SMITE_THREAT_MODIFIER, target); 
                    }
                },
                { id: "cure_disease", name: "Cure Disease", cost: 18, castTime: 0.2, cooldown: 8, type: 'friendly', targetType: 'single', icon: 'fa-solid fa-soap', sound: 'cure_debuff',
                    effect: function(target, caster) {
                        let cleansedCount = 0;
                        target.effects = target.effects.filter(eff => {
                            if (eff.type === 'debuff' && eff.dispellable) { logCombat(`${caster.name} cleanses ${eff.name} from ${target.name}.`, 'cure'); cleansedCount++; if (eff.onExpire) eff.onExpire(target); return false; }
                            return true;
                        });
                        if (cleansedCount === 0) logCombat(`${target.name} had no dispellable debuffs.`); else playSound('cure_success');
                        target.updateDisplay();
                        if (currentEncounter?.getActiveEnemies().length > 0) currentEncounter.getActiveEnemies().forEach(enemy => caster.generateThreat(15 * HEAL_THREAT_MODIFIER * cleansedCount, enemy));
                    }
                },
                { id: "resurrection", name: "Resurrection", cost: 50, castTime: 5.0, cooldown: 180, type: 'friendly', targetType: 'single', icon: 'fa-solid fa-cross', sound: 'ressurect_cast',
                    effect: function(target, caster) {
                        const abilityDef = caster.abilities.find(a => a.id === "resurrection");
                        if (target.currentHp > 0 && !target.isMarkedDead) { 
                            logCombat(`${target.name} is already alive! Resurrection fizzles.`); 
                            if (abilityDef) caster.currentMana = Math.min(caster.maxMana, caster.currentMana + abilityDef.cost);
                            return; 
                        }
                        target.resurrect(0.4);
                        if (currentEncounter?.getActiveEnemies().length > 0) currentEncounter.getActiveEnemies().forEach(enemy => caster.generateThreat(100 * HEAL_THREAT_MODIFIER, enemy));
                    }
                }
            ],
            create: function(pm) {
                Object.assign(pm, {
                    maxMana: this.maxMana, currentMana: this.maxMana,
                    abilities: this.abilities.map(templateAbility => ({ 
                        ...templateAbility, 
                        currentCooldown: 0 
                    })),
                    roleSpecialization: this.name
                });
                // Initialize player stats if not already defined by PartyMember constructor
                if (!pm.stats.spellPower) pm.stats.spellPower = 20; // Base spell power for Cleric
                return pm;
            }
        }
    };

    class PartyMember {
        constructor(id, name, role, maxHp, quirks = [], baseThreatGeneration = 1, maxMana = 0, stats = {}) {
            this.id = id; this.name = name; this.role = role; this.maxHp = maxHp; this.currentHp = maxHp;
            this.isPlayer = (id === 'player'); this.effects = []; this.threat = {}; this.element = null;
            this.actionCooldown = 0; this.baseThreatGeneration = baseThreatGeneration; this.quirks = quirks;
            this.isMarkedDead = false; this.maxMana = maxMana; this.currentMana = maxMana;

            this.stats = { 
                defense: stats.defense || 0, armor: stats.armor || 0, 
                dodgeChance: stats.dodgeChance || 0.05, blockChance: stats.blockChance || 0.05, 
                spellPower: stats.spellPower || 0 
            };
            if (this.isPlayer) { this.abilities = []; }
        }

        showSCT(text, typeClass) {
            const sctContainer = this.element?.querySelector('.sct-container') || 
                               (this === selectedFriendlyTarget && friendlyTargetHealthWrapper?.querySelector('.sct-container')) || 
                               null;
            if (!sctContainer) { return; }
            const sctElement = document.createElement('div'); sctElement.classList.add('sct-text', typeClass); sctElement.textContent = text;
            sctElement.style.left = `${Math.floor(Math.random() * 40) + 30}%`;
            sctContainer.appendChild(sctElement);
            setTimeout(() => { if (sctElement.parentNode === sctContainer) sctContainer.removeChild(sctElement); }, 1450);
        }

        takeDamage(amount, source, spellName = "") {
            if (this.currentHp <= 0 && this.isMarkedDead) return;
            
            if (Math.random() < this.stats.dodgeChance) {
                logCombat(`${this.name} DODGES the attack from ${source?.name || source}!`);
                this.showSCT("Dodge!", "sct-dodge");
                this.updateDisplay(); if (this === selectedFriendlyTarget) updateFriendlyTargetFrame();
                return;
            }
            
            let damageAfterBlock = amount;
            if (Math.random() < this.stats.blockChance) {
                 logCombat(`${this.name} BLOCKS part of the attack from ${source?.name || source}!`);
                 this.showSCT("Block!", "sct-block");
                 damageAfterBlock *= 0.5; 
            }

            let damageAfterArmor = damageAfterBlock * (1 - Math.min(this.stats.armor / 200, 0.75)); 
            let finalDamageToApply = Math.max(0, damageAfterArmor - this.stats.defense); 


            let damageTaken = finalDamageToApply; 
            const sourceName = source?.name || (typeof source === 'string' ? source : "Unknown"); 
            let shieldAbsorbed = 0;

            const activeShields = this.effects.filter(eff => eff.type === 'shield' && eff.shieldValue > 0);
            for (let i = activeShields.length - 1; i >= 0; i--) {
                const shieldEffect = activeShields[i];
                if (damageTaken <= 0) break; 
                const absorbAmount = Math.min(damageTaken, shieldEffect.shieldValue);
                shieldEffect.shieldValue -= absorbAmount; damageTaken -= absorbAmount; shieldAbsorbed += absorbAmount;
                if (shieldEffect.shieldValue <= 0) { logCombat(`${this.name}'s ${shieldEffect.name} breaks after absorbing ${absorbAmount.toFixed(0)}!`); this.effects = this.effects.filter(eff => eff !== shieldEffect); }
                else { logCombat(`${this.name}'s ${shieldEffect.name} absorbs ${absorbAmount.toFixed(0)}. (${shieldEffect.shieldValue.toFixed(0)} left)`); }
            }
            if(shieldAbsorbed > 0) this.showSCT(`${shieldAbsorbed.toFixed(0)}`, 'sct-shield');

            if (damageTaken > 0) {
                this.currentHp = Math.max(0, this.currentHp - damageTaken);
                this.showSCT(`-${damageTaken.toFixed(0)}`, 'sct-damage');
                const logClass = sourceName === "Fire Hazard" ? "fire-damage" : ""; const bySpell = spellName ? ` (by ${spellName})` : "";
                logCombat(`${this.name} takes ${damageTaken.toFixed(0)} damage from ${sourceName}${bySpell}. HP: ${this.currentHp.toFixed(0)}/${this.maxHp}`, logClass);
            }

            if (this.currentHp === 0 && !this.isMarkedDead) {
                this.isMarkedDead = true; logCombat(`${this.name} has fallen!`); this.threat = {}; this.effects = [];
                if (this.isPlayer) endRun("Healer Died");
                else if (party.filter(p => !p.isPlayer && p.currentHp > 0).length === 0 && healer.currentHp > 0) endRun("Party Wiped (Allies Down)");
            }
            this.updateDisplay(); if (this === selectedFriendlyTarget) updateFriendlyTargetFrame();
        }
        
        resurrect(hpPercent) {
            if (this.currentHp <= 0 || this.isMarkedDead) {
                this.currentHp = Math.floor(this.maxHp * hpPercent); this.isMarkedDead = false;
                logCombat(`${this.name} is resurrected with ${this.currentHp} HP!`, 'ressurect');
                this.showSCT(`+${this.currentHp}`, 'sct-heal');
                this.updateDisplay(); if (this === selectedFriendlyTarget) updateFriendlyTargetFrame();
                if (currentEncounter?.getActiveEnemies().length > 0) currentEncounter.getActiveEnemies().forEach(enemy => this.generateThreat(50, enemy));
            }
        }

        heal(amount, healerName = "Unknown Healer", spellName = "Heal") {
            if (this.currentHp <= 0 && this.isMarkedDead) { logCombat(`Cannot heal ${this.name}, they are dead.`); return; }
            if (this.currentHp >= this.maxHp && amount > 0) { return; } 
            
            const healApplied = Math.min(amount, this.maxHp - this.currentHp);
            this.currentHp += healApplied;
            this.currentHp = Math.min(this.maxHp, this.currentHp); 

            if (healApplied > 0) {
                this.showSCT(`+${healApplied.toFixed(0)}`, spellName.toLowerCase().includes("tick") ? 'sct-hot' : 'sct-heal');
            }
            logCombat(`${this.name} is healed by ${healerName} (${spellName}) for ${amount.toFixed(0)} (Effective: ${healApplied.toFixed(0)}). Now: ${this.currentHp.toFixed(0)}/${this.maxHp}`);
            this.updateDisplay(); if (this === selectedFriendlyTarget) updateFriendlyTargetFrame();
        }

        generateThreat(amount, enemyInstance) {
            if (!enemyInstance || this.currentHp === 0 || !enemyInstance.id || this.isMarkedDead) return;
            const enemyId = enemyInstance.id;
            if (!this.threat[enemyId]) this.threat[enemyId] = 0;
            this.threat[enemyId] += amount * this.baseThreatGeneration;
            this.updateDisplay();
            if (enemyInstance.recalculateTarget) enemyInstance.recalculateTarget();
        }
        performAction(activeEnemies) { // Changed to accept array of activeEnemies
            if (this.currentHp === 0 || !encounterActive || this.actionCooldown > 0 || this.isMarkedDead || activeEnemies.length === 0) return;
            
            let primaryTarget = selectedEnemyTarget && activeEnemies.includes(selectedEnemyTarget) ? selectedEnemyTarget : activeEnemies[0];
            if (!primaryTarget || primaryTarget.currentHp <=0) { // Fallback if selected target is dead or invalid
                primaryTarget = activeEnemies.find(e => e.currentHp > 0);
                if(!primaryTarget) return; // No valid targets
            }


            if (this.role === "Tank") {
                const shieldWallEffect = this.effects.find(e => e.name === "Shield Wall");
                if (this.currentHp < this.maxHp * 0.4 && !shieldWallEffect && Math.random() < 0.5) {
                    this.useDefensiveCooldown("Shield Wall", primaryTarget); return;
                }
                const defensiveStanceEffect = this.effects.find(e => e.name === "Defensive Stance");
                if (!defensiveStanceEffect && Math.random() < 0.2) {
                    this.useDefensiveCooldown("Defensive Stance", primaryTarget); return;
                }
                if (Math.random() < 0.3) { this.generateThreat(100 + Math.random() * 50, primaryTarget); logCombat(`${this.name} Taunts ${primaryTarget.name}!`); this.actionCooldown = 5 + Math.random(); }
                else { this.generateThreat(20 + Math.random() * 10, primaryTarget); this.actionCooldown = 2.5 + Math.random(); }
            } else if (this.role === "DPS") {
                if (this.maxMana > 0) {
                    const manaCost = 10; 
                    if (this.currentMana >= manaCost) {
                        this.currentMana -= manaCost;
                        const dpsDamage = 15 + Math.random() * 10 + Math.floor(this.stats.spellPower * 0.3 || 0); 
                        this.generateThreat(dpsDamage * DAMAGE_THREAT_MODIFIER, primaryTarget); 
                        primaryTarget.takeConceptualDamage(dpsDamage); 
                        this.actionCooldown = 2 + Math.random() * 0.5;
                    } else {
                        this.generateThreat(5 * DAMAGE_THREAT_MODIFIER, primaryTarget); 
                        primaryTarget.takeConceptualDamage(5);
                        this.actionCooldown = 3 + Math.random();
                    }
                } else { 
                    const dpsDamage = 15 + Math.random() * 10; 
                    this.generateThreat(dpsDamage * DAMAGE_THREAT_MODIFIER, primaryTarget); 
                    primaryTarget.takeConceptualDamage(dpsDamage); 
                    this.actionCooldown = 2 + Math.random() * 0.5;
                }
            }
            this.actionCooldown = Math.max(1, this.actionCooldown);
            this.updateDisplay();
        }

        useDefensiveCooldown(abilityName, currentEnemyTarget) {
            if (abilityName === "Shield Wall") {
                logCombat(`${this.name} uses Shield Wall! Damage taken reduced.`, 'tank-cooldown');
                this.applyEffect({ name: "Shield Wall", type: "buff", icon: "fa-solid fa-user-shield", duration: 8000, 
                                   damageReductionFactor: 0.5, // Store as factor
                                   onExpire: (target) => logCombat("Shield Wall fades from " + target.name) });
                this.actionCooldown = 30; 
                if(currentEnemyTarget) this.generateThreat(30, currentEnemyTarget);
            } else if (abilityName === "Defensive Stance") {
                logCombat(`${this.name} enters Defensive Stance! Armor and Block increased.`, 'tank-cooldown');
                const originalArmor = this.stats.armor; const originalBlock = this.stats.blockChance;
                this.stats.armor += 20; this.stats.blockChance = Math.min(1, this.stats.blockChance + 0.2); // Cap block at 100%
                this.applyEffect({ name: "Defensive Stance", type: "buff", icon: "fa-solid fa-shield-virus", duration: 12000, 
                                   onExpire: (target) => {
                                       logCombat("Defensive Stance fades from " + target.name);
                                       target.stats.armor = originalArmor; target.stats.blockChance = originalBlock;
                                       target.updateDisplay(); // Update display after stats revert
                                   }});
                this.actionCooldown = 45; 
                if(currentEnemyTarget) this.generateThreat(25, currentEnemyTarget);
            }
            this.updateDisplay();
        }

        applyEffect(effect) {
            this.effects = this.effects.filter(eff => eff.name !== effect.name || (effect.stackable));
            this.effects.push({ ...effect, startTime: Date.now() });
            if (effect.onTick) effect.lastTickTime = Date.now();
            this.updateDisplay(); if (this === selectedFriendlyTarget) updateFriendlyTargetFrame();
        }
        processEffects() {
            const now = Date.now(); let changed = false;
            this.effects = this.effects.filter(effect => {
                if (now >= effect.startTime + effect.duration) { if (effect.onExpire) effect.onExpire(this); changed = true; return false; }
                if (effect.onTick && effect.ticksRemaining > 0 && now >= (effect.lastTickTime || effect.startTime) + effect.tickInterval) {
                    if(this.currentHp > 0 && !this.isMarkedDead) effect.onTick(this);
                    effect.ticksRemaining--; effect.lastTickTime = now; changed = true;
                    if (effect.ticksRemaining === 0 && !(effect.duration > (now - effect.startTime))) { if (effect.onExpire) effect.onExpire(this); return false; }
                }
                return true;
            });
            if (changed) { this.updateDisplay(); if (this === selectedFriendlyTarget) updateFriendlyTargetFrame(); }
        }
        updateDisplay() {
            if (!this.element) return;
            const healthBar = this.element.querySelector('.health-bar');
            const shieldBar = this.element.querySelector('.shield-bar');
            const manaBar = this.element.querySelector('.mana-bar');

            const healthPercentage = this.currentHp > 0 ? (this.currentHp / this.maxHp) * 100 : 0;
            healthBar.style.width = `${healthPercentage}%`;
            if (this.currentHp <= 0 || this.isMarkedDead) { healthBar.textContent = "DEAD"; healthBar.className = 'health-bar dead'; }
            else { healthBar.textContent = `${Math.ceil(this.currentHp)}/${this.maxHp}`; healthBar.className = 'health-bar'; if (healthPercentage <= 30) healthBar.classList.add('low'); else if (healthPercentage <= 60) healthBar.classList.add('medium'); }

            let totalShieldValue = 0; this.effects.forEach(eff => { if (eff.type === 'shield' && eff.shieldValue > 0) totalShieldValue += eff.shieldValue; });
            if (shieldBar) { shieldBar.style.width = `${Math.min(100, (totalShieldValue / this.maxHp) * 100)}%`; }

            if (manaBar && this.maxMana > 0) {
                const manaPercentage = this.maxMana > 0 ? (this.currentMana / this.maxMana) * 100 : 0;
                manaBar.style.width = `${manaPercentage}%`;
                manaBar.textContent = `${Math.floor(this.currentMana)}/${this.maxMana}`;
            }

            const statusContainer = this.element.querySelector('.status-effects'); statusContainer.innerHTML = '';
            this.effects.forEach(eff => {
                const iconEl = document.createElement('i');
                iconEl.className = eff.icon || (eff.type === 'debuff' ? 'fa-solid fa-skull-crossbones' : 'fa-solid fa-question-circle');
                iconEl.title = `${eff.name} (${eff.casterName || 'System'})` + (eff.shieldValue ? ` ${eff.shieldValue.toFixed(0)}` : '') + (eff.healPerTick ? ` ${eff.healPerTick.toFixed(0)}/t` : '');
                statusContainer.appendChild(iconEl);
            });
            const threatDiv = this.element.querySelector('.threat-value');
            if (currentEncounter?.getActiveEnemies().length > 0 && this.threat[currentEncounter.getActiveEnemies()[0].id] !== undefined) { // Simplified to show threat on primary enemy
                threatDiv.textContent = `T: ${this.threat[currentEncounter.getActiveEnemies()[0].id].toFixed(0)}`; 
            } else { threatDiv.textContent = `T: 0`; }
        }
        createElement() {
            const memberDiv = document.createElement('div'); memberDiv.classList.add('party-member'); memberDiv.dataset.id = this.id;
            let manaBarHtml = '';
            if (this.maxMana > 0) {
                manaBarHtml = `<div class="resource-bar-container mana-bar-container"><div class="mana-bar"></div></div>`;
            }
            memberDiv.innerHTML = `<h4>${this.name} (${this.role})</h4><div class="sct-container"></div><div class="health-bar-container"><div class="shield-bar"></div><div class="health-bar"></div></div>${manaBarHtml}<div class="status-effects"></div><div class="threat-value">T: 0</div>`;
            memberDiv.addEventListener('click', (event) => { event.stopPropagation(); selectFriendlyTarget(this); });
            this.element = memberDiv; this.updateDisplay(); return memberDiv;
        }
    }

    class Enemy {
        constructor(id, name, maxHp, minDamage, maxDamage, attackSpeed, specialAbilities = [], maxMana = 0, stats = {}) {
            this.id = id; this.name = name; this.maxHp = maxHp; this.currentHp = maxHp;
            this.minDamage = minDamage; this.maxDamage = maxDamage; this.attackSpeed = attackSpeed;
            this.attackCooldown = Math.random() * attackSpeed; this.currentTarget = null; this.element = null;
            this.specialAbilities = specialAbilities.map(sa => ({ ...sa, currentCooldown: Math.random() * sa.cooldown }));
            this.isCastingSpecial = false; this.specialCastTimer = 0;
            this.maxMana = maxMana; this.currentMana = maxMana;
            this.stats = { defense: stats.defense || 0, armor: stats.armor || 0, dodgeChance: stats.dodgeChance || 0.02, blockChance: stats.blockChance || 0 };
        }
        showSCT(text, typeClass) { /* ... same ... */ }
        attack() { /* ... same ... */ }
        useSpecialAbility(special) { /* ... (updated to pass spellName to takeDamage) ... */
            if (!this.currentTarget || this.currentTarget.currentHp <= 0 || this.currentTarget.isMarkedDead) { this.recalculateTarget(); if(!this.currentTarget || this.currentTarget.currentHp <=0 || this.currentTarget.isMarkedDead) return; }
            if (this.maxMana > 0 && special.manaCost) { if (this.currentMana < special.manaCost) { logCombat(`${this.name} tries ${special.name} but OOM!`); special.currentCooldown = special.cooldown / 2; return; } this.currentMana -= special.manaCost; }
            logCombat(`${this.name} begins casting ${special.name}!`, "enemy-special-cast"); this.isCastingSpecial = true; this.specialCastTimer = special.castTime; this.updateDisplay();
            setTimeout(() => {
                if(this.currentHp <=0) { this.isCastingSpecial = false; this.specialCastTimer = 0; this.updateDisplay(); return; }
                this.isCastingSpecial = false; this.specialCastTimer = 0;
                if (this.currentTarget && this.currentTarget.currentHp > 0 && !this.currentTarget.isMarkedDead) { logCombat(`${this.name} unleashes ${special.name} on ${this.currentTarget.name}!`, "enemy-special-cast"); special.effect(this.currentTarget, this, special.name); } // Pass special.name
                else { logCombat(`${this.name}'s ${special.name} fizzles.`); }
                special.currentCooldown = special.cooldown; this.updateDisplay(); if (this === selectedEnemyTarget) updateEnemyTargetFrame();
            }, special.castTime * 1000);
        }
        updateSpecialAbilityCooldowns(tickAmount) { /* ... same ... */ }
        takeDamageFromPlayer(amount, sourcePlayer, spellName = "") {
            if (this.currentHp <= 0) return;
            if (Math.random() < this.stats.dodgeChance) { logCombat(`${this.name} DODGES ${spellName || 'attack'} from ${sourcePlayer.name}!`); this.showSCT("Dodge!", "sct-dodge"); this.updateDisplay(); if (this === selectedEnemyTarget) updateEnemyTargetFrame(); return; }
            let damageAfterArmor = amount * (1 - Math.min(this.stats.armor / 200, 0.75));
            let finalDamage = Math.max(0, damageAfterArmor - this.stats.defense);
            this.currentHp = Math.max(0, this.currentHp - finalDamage);
            this.showSCT(`-${finalDamage.toFixed(0)}`, 'sct-damage');
            const bySpell = spellName ? ` (by ${spellName})` : "";
            logCombat(`${this.name} takes ${finalDamage.toFixed(0)} damage from ${sourcePlayer.name}${bySpell}. HP: ${this.currentHp.toFixed(0)}/${this.maxHp}`);
            if (this.currentHp === 0) { currentEncounter.removeDefeatedEnemy(this); if (!currentEncounter.isActive()) endEncounter(true); } // Check if all dead
            this.updateDisplay(); if (this === selectedEnemyTarget) updateEnemyTargetFrame();
        }
        takeConceptualDamage(amount) {
             if (this.currentHp <= 0) return;
            let damageAfterArmor = amount * (1 - Math.min(this.stats.armor / 200, 0.75));
            let finalDamage = Math.max(0, damageAfterArmor - this.stats.defense);
            this.currentHp = Math.max(0, this.currentHp - finalDamage);
            this.showSCT(`-${finalDamage.toFixed(0)}`, 'sct-damage');
            if (this.currentHp === 0) { logCombat(`${this.name} succumbs to party damage!`); currentEncounter.removeDefeatedEnemy(this); if (!currentEncounter.isActive()) endEncounter(true); }
            this.updateDisplay(); if (this === selectedEnemyTarget) updateEnemyTargetFrame();
        }
        recalculateTarget() { /* ... same ... */ }
        createVisualElement() { /* ... same ... */ }
        updateDisplay() { /* ... same ... */ }
    }
    
    class Encounter {
        constructor(enemyConfigs) {
            this.enemies = enemyConfigs.map(config => new Enemy(config.id, config.name, config.maxHp, config.minDamage, config.maxDamage, config.attackSpeed, config.specialAbilities, config.maxMana, config.stats));
            this.xpValue = enemyConfigs.reduce((sum, conf) => sum + (conf.xp || 25), 0);
            this.lootTable = enemyConfigs.reduce((acc, conf) => acc.concat(conf.loot || []), []);
        }
        spawnVisuals() { 
            enemyDisplayArea.innerHTML = ''; 
            // For now, only the first *active* enemy gets a detailed display and is targetable initially
            const firstActiveEnemy = this.getActiveEnemies()[0];
            if (firstActiveEnemy) {
                const primaryEnemyVisual = firstActiveEnemy.createVisualElement();
                if(primaryEnemyVisual) enemyDisplayArea.appendChild(primaryEnemyVisual);
                enemyDisplayArea.onclick = (event) => { event.stopPropagation(); selectEnemyTarget(firstActiveEnemy); };
            } else {
                 enemyDisplayArea.innerHTML = "<p>No enemies present.</p>";
            }
            // Log other enemies
            if (this.enemies.length > 1) {
                let otherEnemies = this.enemies.slice(1).map(e => e.name).join(', ');
                if(otherEnemies) logCombat(`Also in combat: ${otherEnemies}`);
            }
        }
        getActiveEnemies() { return this.enemies.filter(e => e.currentHp > 0); }
        isActive() { return this.getActiveEnemies().length > 0; }
        removeDefeatedEnemy(defeatedEnemy) {
            // This method is implicitly handled by getActiveEnemies now for encounter status
            // If selected target was defeated, select a new one
            if (selectedEnemyTarget === defeatedEnemy) {
                selectEnemyTarget(this.getActiveEnemies()[0] || null);
                // If the main displayed enemy was defeated, re-render visuals for the next one
                if (this.getActiveEnemies().length > 0 && (!enemyDisplayArea.firstChild || !document.getElementById(`enemy-unit-${this.getActiveEnemies()[0].id}`))) {
                    this.spawnVisuals();
                }
            }
        }
    }

    function initializePartyAndHealer() {
        if (!partyFramesContainer || !abilityButtonsContainer || !manaValueDisplay || !friendlyTargetHealthWrapper || !enemyTargetHealthWrapper) { console.error("CRITICAL DOM INIT ERROR"); alert("Error: Game UI could not be initialized."); return false; }
        party = [
            new PartyMember('tank', 'Grongar', 'Tank', 250, [], 1.6, 0, { defense: 10, armor: 30, dodgeChance: 0.1, blockChance: 0.15 }),
            new PartyMember('dps1', 'Zippy', 'DPS', 100, ['stands_in_fire'], 1.0, 0, { defense: 2, armor: 10, dodgeChance: 0.05 }),
            new PartyMember('dps2', 'Mystara', 'DPS', 90, [], 1.0, 80, { defense: 0, armor: 5, dodgeChance: 0.03, spellPower: 15 }),
            new PartyMember('player', 'Player', 'Healer', 100, [], 1.0, 0, { defense: 3, armor: 10, dodgeChance: 0.05 })
        ];
        healer = party.find(p => p.isPlayer); healerClasses.Cleric.create(healer);
        partyFramesContainer.innerHTML = ''; party.forEach(member => { member.isMarkedDead = false; partyFramesContainer.appendChild(member.createElement()); member.actionCooldown = Math.random() * 2; });
        selectFriendlyTarget(healer); selectEnemyTarget(null); updateHealerStatusUI(); renderAbilityHotbar(); return true;
    }

    function updateHealerStatusUI() { if (!healer) return; manaValueDisplay.textContent = Math.floor(healer.currentMana); maxManaValueDisplay.textContent = healer.maxMana; }
    function renderAbilityHotbar() { /* ... same ... */ }
    function updateAbilityButtonStates() { /* ... same ... */ }
    function selectFriendlyTarget(member) { /* ... same ... */ }
    function selectEnemyTarget(enemyInstance) {
        if (selectedEnemyTarget && currentEncounter?.getActiveEnemies().find(e => e === selectedEnemyTarget)?.element) {
             enemyDisplayArea.classList.remove('selected-enemy-target-area');
        }
        selectedEnemyTarget = enemyInstance;
        // Update main enemy display only if the selected enemy is the one currently shown or if no enemy is shown
        if (enemyInstance && (!enemyDisplayArea.firstChild || enemyDisplayArea.firstChild.id === `enemy-unit-${enemyInstance.id}`)) {
            // If currentEncounter has multiple enemies, and we want to switch the main display:
            // enemyDisplayArea.innerHTML = ''; // Clear old
            // const newVisual = enemyInstance.createVisualElement();
            // if (newVisual) enemyDisplayArea.appendChild(newVisual);
        }

        if (selectedEnemyTarget && currentEncounter?.getActiveEnemies().find(e => e === selectedEnemyTarget)?.element) {
            enemyDisplayArea.classList.add('selected-enemy-target-area');
        } else if (!selectedEnemyTarget && enemyDisplayArea) { 
            enemyDisplayArea.classList.remove('selected-enemy-target-area');
        }
        updateEnemyTargetFrame();
    }
    function updateFriendlyTargetFrame() { /* ... same ... */ }
    function updateEnemyTargetFrame() { /* ... same ... */ }
    function playSound(soundName) { /* Placeholder */ }
    
    function attemptUseAbility(ability) {
        let actualTarget = null; 
        // console.log(`[Attempt Cast] Trying to use: ${ability.name}. Caster: ${healer?.name}, Initial Selected Friendly: ${selectedFriendlyTarget?.name}, Initial Selected Enemy: ${selectedEnemyTarget?.name}`);
        
        if (isCasting) { logCombat("Cannot cast: Already casting!"); playSound("error_casting"); return; }
        
        if (ability.type === 'friendly') {
            if (!selectedFriendlyTarget) { logCombat(`No friendly target for ${ability.name}!`); playSound("error_target"); return; }
            if (ability.id === "resurrection") { 
                if (!selectedFriendlyTarget.isMarkedDead) { logCombat(`${selectedFriendlyTarget.name} is not dead! Resurrection requires a dead target.`); playSound("error_target"); return; }
            } else if (selectedFriendlyTarget.currentHp <= 0 || selectedFriendlyTarget.isMarkedDead) { 
                logCombat(`Cannot cast ${ability.name} on fallen ${selectedFriendlyTarget.name}!`); playSound("error_target"); return; 
            }
            actualTarget = selectedFriendlyTarget;
        } else if (ability.type === 'offensive') {
            if (!selectedEnemyTarget) { logCombat(`No enemy target for ${ability.name}!`); playSound("error_target"); return; }
            if (selectedEnemyTarget.currentHp <= 0) { logCombat(`Cannot attack defeated ${selectedEnemyTarget.name}!`); playSound("error_target"); return; }
            actualTarget = selectedEnemyTarget;
        } else if (ability.type === 'self') { 
            actualTarget = healer; 
            if (!healer || healer.currentHp <= 0 || healer.isMarkedDead) { logCombat(`Cannot cast self-spell, healer is incapacitated!`); playSound("error_target"); return;}
        }

        if (ability.targetType === 'single' && !actualTarget && ability.type !== 'self') { logCombat(`Target error for ${ability.name}`); return; }
        if (!healer || healer.currentMana < ability.cost) { logCombat("Not enough mana!"); playSound("error_mana"); return; }
        if (ability.currentCooldown > 0) { logCombat(`${ability.name} is on cooldown!`); playSound("error_cooldown"); return; }

        isCasting = true; healer.currentMana -= ability.cost; updateHealerStatusUI(); updateAbilityButtonStates(); playSound(ability.sound || "cast_generic");
        if (castTimeoutId) clearTimeout(castTimeoutId);

        const castTarget = actualTarget; 
        const castCaster = healer; 

        const executeEffect = () => {
            // console.log(`%c[ExecuteEffect TRYING] Spell: ${ability.name}, Target: ${castTarget?.name}, Caster: ${castCaster?.name}`, "color: yellow;");
            // console.log(`   > Target valid? ${!!castTarget}, Target HP: ${castTarget?.currentHp}, Target Dead?: ${castTarget?.isMarkedDead}`);
            // console.log(`   > Caster valid? ${!!castCaster}, Caster HP: ${castCaster?.currentHp}`);
            // console.log(`   > ability.effect is function? ${typeof ability.effect === 'function'}`);

            let canApply = false;
            if (ability.type === 'friendly') {
                if (castTarget && (castTarget.currentHp > 0 || (ability.id === "resurrection" && castTarget.isMarkedDead))) {
                    canApply = true;
                }
            } else if (ability.type === 'offensive') {
                if (castTarget && castTarget.currentHp > 0) {
                    canApply = true;
                }
            } else if (ability.type === 'self') {
                if (castTarget && castTarget.currentHp > 0) { 
                    canApply = true;
                }
            }
            // console.log(`   > canApply condition result: ${canApply}`);

            if (ability.effect && typeof ability.effect === 'function' && canApply) {
                // console.log(`%c[ExecuteEffect APPLYING] ${ability.name} on ${castTarget?.name}`, "color: green; font-weight:bold;");
                ability.effect(castTarget, castCaster);
            } else {
                logCombat(`${ability.name} fizzles, target ${castTarget?.name || ''} no longer valid or conditions not met.`);
                // console.log(`%c[ExecuteEffect FIZZLED] ${ability.name}. Target: ${castTarget?.name}, Target HP: ${castTarget?.currentHp}, Target Dead: ${castTarget?.isMarkedDead}, Effect Type: ${typeof ability.effect}`, "color: red;");
            }

            if (ability.cooldown > 0) startCooldown(ability); 
            else updateAbilityButtonStates();
            
            if (currentEncounter?.getActiveEnemies().length > 0) currentEncounter.getActiveEnemies().forEach(enemy => enemy.recalculateTarget());
        };

        if (ability.castTime > 0) {
            castingBarContainer.style.display = 'block'; castingSpellName.textContent = `Casting: ${ability.name}`;
            castingBarProgress.style.transition = 'none'; castingBarProgress.style.width = '0%';
            void castingBarProgress.offsetWidth; castingBarProgress.style.transition = `width ${ability.castTime}s linear`;
            castingBarProgress.style.width = '100%';
            castTimeoutId = setTimeout(() => {
                castingBarContainer.style.display = 'none'; isCasting = false; castTimeoutId = null;
                executeEffect();
            }, ability.castTime * 1000);
        } else { 
            isCasting = false; 
            executeEffect();
        }
    }
    function startCooldown(ability) { ability.currentCooldown = ability.cooldown * 1000; updateAbilityButtonStates(); }
    function updateCooldownsAndManaRegen() { /* ... same ... */ }
    function logCombat(message, className = "") { /* ... same ... */ }
    function handleFireHazard() { /* ... same ... */ }
    
    function spawnAndStartEncounter() {
        totalXPEarnedThisRun = 0; 
        const enemyConfigs = [
            {id: 'goblin_grunt_1', name: 'Goblin Grunt', maxHp: 300, minDamage: 10, maxDamage: 15, attackSpeed: 2.2, stats: {armor: 5, defense: 2}, xp: 10, loot: ['Goblin Ear']},
            {id: 'goblin_grunt_2', name: 'Goblin Grunt', maxHp: 280, minDamage: 10, maxDamage: 16, attackSpeed: 2.3, stats: {armor: 5, defense: 2}, xp: 10, loot: ['Dirty Rag']},
        ];
        if (Math.random() < 0.5) { 
            enemyConfigs.push({id: 'goblin_scout_1', name: 'Goblin Scout', maxHp: 250, minDamage: 12, maxDamage: 18, attackSpeed: 1.9, stats: {armor: 2, defense: 1, dodgeChance: 0.1}, xp: 15, loot: ['Pointy Stick']});
        }
        const warchiefSpecialAbilities = [ { name: "Heavy Slam", castTime: 1.2, cooldown: 10, manaCost: 20, effect: (target, enemy, spellName) => { const damage = enemy.minDamage * 2; target.takeDamage(damage, enemy, spellName); } } ];
        enemyConfigs.push({id: 'goblin_warchief_1', name: 'Goblin Warchief', maxHp: 700, minDamage: 20, maxDamage: 30, attackSpeed: 2.8, specialAbilities: warchiefSpecialAbilities, maxMana: 100, stats: {armor: 15, defense: 5}, xp: 50, loot: ['Warchief\'s Helm Shard']});


        currentEncounter = new Encounter(enemyConfigs); 
        logCombat(`Encounter started: ${currentEncounter.enemies.map(e=>e.name).join(', ')} appear!`);
        encounterActive = true; currentEncounter.spawnVisuals(); 
        selectEnemyTarget(currentEncounter.getActiveEnemies()[0] || null);

        party.forEach(member => { 
            member.threat = {}; 
            currentEncounter.enemies.forEach(enemy => member.threat[enemy.id] = 0); 
            member.isMarkedDead = false; 
            if(member.role === "Tank") currentEncounter.enemies.forEach(enemy => member.generateThreat(50, enemy)); 
            else currentEncounter.enemies.forEach(enemy => member.generateThreat(1, enemy));
            member.actionCooldown = Math.random() * 1.5; 
            member.currentHp = member.maxHp; member.currentMana = member.maxMana; 
            member.effects = []; member.updateDisplay(); 
        });
        healer.currentMana = healer.maxMana; updateHealerStatusUI(); 
        currentEncounter.enemies.forEach(enemy => enemy.recalculateTarget());
        updateAbilityButtonStates(); updateFriendlyTargetFrame();
        
        if(hazardInterval) clearInterval(hazardInterval); 
        hazardInterval = setInterval(handleFireHazard, FIRE_DAMAGE_INTERVAL);
        
        if(addSpawnInterval) clearInterval(addSpawnInterval);
        addSpawnInterval = setInterval(trySpawnAdd, 20000); // Try to spawn an add every 20 seconds
    }

    function trySpawnAdd() {
        if (!encounterActive || !currentEncounter || !currentEncounter.isActive() || currentEncounter.getActiveEnemies().length >= 5) return; // Cap total enemies
        if (Math.random() < ADD_SPAWN_CHANCE_PER_TICK * 100) { // Check chance (scaled because gameTick is 100ms)
            const addConfig = {id: `goblin_add_${Date.now()}`, name: 'Goblin Reinforcement', maxHp: 150, minDamage: 8, maxDamage: 12, attackSpeed: 2.5, stats: {armor: 3}, xp: 5, loot: ['Small Rock']};
            const newAdd = new Enemy(addConfig.id, addConfig.name, addConfig.maxHp, addConfig.minDamage, addConfig.maxDamage, addConfig.attackSpeed, [], 0, addConfig.stats);
            currentEncounter.enemies.push(newAdd);
            logCombat(`${newAdd.name} joins the fight!`);
            party.forEach(member => {
                member.threat[newAdd.id] = 0;
                if (member.role === "Tank") member.generateThreat(30, newAdd); 
                else member.generateThreat(1, newAdd);
            });
            newAdd.recalculateTarget();
            // Note: Visual for new adds beyond the first one is not yet implemented in main enemy display area.
            // They will participate in combat logic.
        }
    }

    function endEncounter(victory) {
        if (!encounterActive) return; 
        encounterActive = false; isCasting = false;
        if(castTimeoutId) clearTimeout(castTimeoutId); castingBarContainer.style.display = 'none';
        if(hazardInterval) clearInterval(hazardInterval);
        if(addSpawnInterval) clearInterval(addSpawnInterval);

        if (victory) { 
            logCombat(`Victory! All enemies defeated.`); 
            playSound("victory_encounter");
            totalXPEarnedThisRun += currentEncounter.xpValue;
            logCombat(`Party gains ${currentEncounter.xpValue} XP! (Total this run: ${totalXPEarnedThisRun})`);
            
            let droppedLoot = [];
            currentEncounter.lootTable.forEach(item => {
                if(Math.random() < 0.3) { droppedLoot.push(item); }
            });
            if(droppedLoot.length > 0) { logCombat(`Loot dropped: ${droppedLoot.join(', ')}!`); } 
            else { logCombat(`No specific loot dropped this time.`); }
            setTimeout(() => endRun("Run Completed (Victory!)"), 3000); 
        } else { 
            logCombat("Defeat! The party has fallen.");
            playSound("defeat_party");
             // If defeat wasn't triggered by player/party wipe directly, call endRun
            setTimeout(() => endRun("Run Ended (Defeat)"), 1000);
        }
        if(enemyDisplayArea) enemyDisplayArea.innerHTML = '<p>[Encounter Ended]</p>'; if(enemyDisplayArea && enemyDisplayArea.onclick) enemyDisplayArea.onclick = null;
        currentEncounter = null; selectEnemyTarget(null); updateAbilityButtonStates();
    }

    function gameTick() {
        if (!encounterActive || !currentEncounter || !currentEncounter.isActive()) return;
        const tickIntervalSeconds = 0.1;
        const activeEnemies = currentEncounter.getActiveEnemies();

        if (activeEnemies.length === 0 && encounterActive) { // Double check if all enemies are defeated
            endEncounter(true);
            return;
        }

        activeEnemies.forEach(enemy => {
            enemy.updateSpecialAbilityCooldowns(tickIntervalSeconds);
            if (!enemy.isCastingSpecial) { 
                if (enemy.attackCooldown > 0) enemy.attackCooldown -= tickIntervalSeconds; 
                else enemy.attack(); 
            }
        });
        
        party.forEach(member => {
            if (!member.isPlayer && member.currentHp > 0 && !member.isMarkedDead) { 
                if (member.actionCooldown > 0) member.actionCooldown -= tickIntervalSeconds; 
                else member.performAction(activeEnemies); 
            }
            member.processEffects();
        });
        // currentEncounter.removeDefeated(); // Handled by takeDamage/takeConceptualDamage now
    }
    function startNewRun() {
        if (!initializePartyAndHealer()) return;
        gameContainer.style.display = 'grid'; metaHub.style.display = 'none'; combatLog.innerHTML = '';
        logCombat("A new adventure begins!");
        setTimeout(spawnAndStartEncounter, 500);
    }
    function endRun(reason) {
        logCombat(`Run Ended: ${reason}.`); encounterActive = false; isCasting = false;
        if (castTimeoutId) clearTimeout(castTimeoutId); castingBarContainer.style.display = 'none';
        if(hazardInterval) clearInterval(hazardInterval);
        if(addSpawnInterval) clearInterval(addSpawnInterval);
        runsCompleted++; runsCompletedDisplay.textContent = runsCompleted;
        gameContainer.style.display = 'none'; metaHub.style.display = 'block';
        currentEncounter = null; if(enemyDisplayArea) enemyDisplayArea.innerHTML = '<p>[Waiting for encounter...]</p>';
        if(enemyDisplayArea && enemyDisplayArea.onclick) enemyDisplayArea.onclick = null; selectEnemyTarget(null); selectFriendlyTarget(null);
    }
    document.addEventListener('keydown', (event) => {
        if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA') return;
        // Allow keybinds even if not strictly "encounterActive" for potential out-of-combat utility spells later
        // but not if casting.
        if (isCasting && !(event.key >= '1' && event.key <= '9')) return;


        const keyNum = parseInt(event.key);
        if (healer && healer.abilities && keyNum >= 1 && keyNum <= healer.abilities.length) {
            const ability = healer.abilities[keyNum - 1];
            if (ability) { event.preventDefault(); attemptUseAbility(ability); }
        }
    });
    startNewRunButton.addEventListener('click', startNewRun);
    if (gameLoopInterval) clearInterval(gameLoopInterval); gameLoopInterval = setInterval(gameTick, 100);
    if (uiUpdateInterval) clearInterval(uiUpdateInterval); uiUpdateInterval = setInterval(() => {
        updateCooldownsAndManaRegen();
        if (encounterActive) { 
            party.forEach(m => m.updateDisplay());
            if(currentEncounter?.getActiveEnemies().length > 0) {
                // Update only the selected enemy's main display for now
                const mainDisplayedEnemy = currentEncounter.getActiveEnemies().find(e => e.element && enemyDisplayArea.contains(e.element));
                if(mainDisplayedEnemy) mainDisplayedEnemy.updateDisplay();
                else if (currentEncounter.getActiveEnemies()[0]) { // If main display is empty, try to show first active
                    currentEncounter.spawnVisuals(); // This might re-render the first active enemy
                }
            } else if (currentEncounter && !currentEncounter.isActive() && encounterActive) {
                // This case might be redundant if endEncounter is called promptly
            }
            if(selectedFriendlyTarget) updateFriendlyTargetFrame();
            if(selectedEnemyTarget) updateEnemyTargetFrame();
        } else { 
            updateHealerStatusUI(); 
            if (healer?.abilities) updateAbilityButtonStates();
        }
    }, 100); 
    gameContainer.style.display = 'none'; metaHub.style.display = 'block';
    if(enemyDisplayArea) enemyDisplayArea.innerHTML = '<p>[Waiting for encounter...]</p>';
    updateFriendlyTargetFrame(); updateEnemyTargetFrame();
});