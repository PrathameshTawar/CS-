import { GAME_EVENTS } from '../../gameplay/core/GameTypes';
export class MissionAgent {
    bus;
    currentMission = null;
    progress = 0;
    timeElapsed = 0;
    isComplete = false;
    targetCount = 1;
    updateTimer = 0;
    disposers = [];
    constructor(bus) {
        this.bus = bus;
        this.registerEvents();
    }
    registerEvents() {
        this.disposers.push(this.bus.on(GAME_EVENTS.KILL, (e) => {
            if (e.killerId === -1 && this.currentMission && !this.isComplete) {
                if (this.currentMission.objectiveType === 'elimination' ||
                    this.currentMission.objectiveType === 'defense') {
                    this.progress++;
                    this.evaluateMission();
                }
            }
        }), this.bus.on(GAME_EVENTS.HEALTH, (e) => {
            if (e.health <= 0 && this.currentMission && !this.isComplete) {
                this.failMission('Player eliminated.');
            }
        }));
    }
    setMission(mission) {
        this.currentMission = mission;
        this.progress = 0;
        this.timeElapsed = 0;
        this.isComplete = false;
        this.targetCount = mission.targetCount || 10;
        this.updateTimer = 0;
        this.emitObjectiveUpdate();
    }
    getMission() {
        return this.currentMission;
    }
    /**
     * T2.4: Player-context mission flavoring (R29.5).
     * Generates a mission tailored to low health (stealth/extraction)
     * or explosion-heavy loadout / high kills (convoy destruction).
     */
    generateFlavoredMission(context) {
        const isLowHealth = context.health !== undefined &&
            ((context.maxHealth !== undefined && context.health / context.maxHealth < 0.35) ||
                context.health < 35);
        if (isLowHealth) {
            return {
                objectiveType: 'extraction',
                title: 'Silent Extraction',
                briefing: 'Low health detected — avoid direct contact and reach extraction without alerting guards.',
                successCondition: 'Survive extraction timer.',
                failureCondition: 'Player is eliminated.',
                targetCount: 10,
            };
        }
        const isExplosiveLoadout = (context.loadout && context.loadout.some((item) => /rocket|grenade|explosive|c4|rpg/i.test(item))) ||
            (context.kills ?? 0) >= 15;
        if (isExplosiveLoadout) {
            return {
                objectiveType: 'elimination',
                title: 'Convoy Destruction',
                briefing: 'Heavy ordnance equipped — destroy the armored patrol convoy.',
                successCondition: 'Eliminate convoy targets.',
                failureCondition: 'Player is eliminated.',
                targetCount: 5,
            };
        }
        const type = context.objectiveType ?? 'defense';
        switch (type) {
            case 'elimination':
                return {
                    objectiveType: 'elimination',
                    title: 'Clear the Area',
                    briefing: 'Eliminate all hostile forces in the sector.',
                    successCondition: 'Eliminate target count of hostiles.',
                    failureCondition: 'Player is eliminated.',
                    targetCount: 10,
                };
            case 'extraction':
                return {
                    objectiveType: 'extraction',
                    title: 'Evacuate Sector',
                    briefing: 'Survive and hold position until extraction arrives.',
                    successCondition: 'Survive extraction timer.',
                    failureCondition: 'Player is eliminated.',
                    targetCount: 15,
                };
            case 'capture':
                return {
                    objectiveType: 'capture',
                    title: 'Secure Uplink',
                    briefing: 'Hold and capture the tactical uplink zone.',
                    successCondition: 'Capture target control points.',
                    failureCondition: 'Player is eliminated.',
                    targetCount: 10,
                };
            case 'defense':
            default:
                return {
                    objectiveType: 'defense',
                    title: 'Defend the Zone',
                    briefing: 'Hold the line against incoming waves.',
                    successCondition: 'Survive all waves.',
                    failureCondition: 'Player is eliminated.',
                    targetCount: 5,
                };
        }
    }
    update(deltaTime) {
        if (!this.currentMission || this.isComplete)
            return;
        this.timeElapsed += deltaTime;
        this.updateTimer += deltaTime;
        if (this.currentMission.objectiveType === 'defense' || this.currentMission.objectiveType === 'extraction') {
            if (this.updateTimer >= 5) {
                this.updateTimer = 0;
                this.progress++;
            }
        }
        else if (this.currentMission.objectiveType === 'capture') {
            if (this.updateTimer >= 2) {
                this.updateTimer = 0;
                this.progress++;
            }
        }
        this.evaluateMission();
    }
    evaluateMission() {
        if (!this.currentMission || this.isComplete)
            return;
        this.emitObjectiveUpdate();
        if (this.progress >= this.targetCount || (this.currentMission.objectiveType === 'extraction' && this.timeElapsed >= this.targetCount)) {
            this.succeedMission();
        }
    }
    succeedMission() {
        if (!this.currentMission || this.isComplete)
            return;
        this.isComplete = true;
        this.bus.emit('ai.mission.complete', {
            outcome: 'success',
            elapsedTime: this.timeElapsed,
            mission: this.currentMission,
        });
    }
    failMission(reason) {
        if (!this.currentMission || this.isComplete)
            return;
        this.isComplete = true;
        this.bus.emit('ai.mission.complete', {
            outcome: 'failure',
            elapsedTime: this.timeElapsed,
            mission: this.currentMission,
            reason,
        });
    }
    emitObjectiveUpdate() {
        if (!this.currentMission)
            return;
        const isWave = this.currentMission.objectiveType === 'defense';
        const current = Math.min(this.progress, this.targetCount);
        this.bus.emit(GAME_EVENTS.OBJECTIVE, {
            text: this.currentMission.briefing || this.currentMission.title,
            progress: {
                current: isWave ? current + 1 : current,
                target: this.targetCount
            },
            isWave
        });
    }
    dispose() {
        this.disposers.forEach((d) => d());
        this.disposers = [];
    }
}
//# sourceMappingURL=MissionAgent.js.map