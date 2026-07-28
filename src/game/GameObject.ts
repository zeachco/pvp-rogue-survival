import * as THREE from "three";

export abstract class GameObject {
	active = true;
	readonly mesh = new THREE.Group();

	abstract update(deltaSeconds: number): void;

	updateVisuals(_time: number): void {
		this.mesh.visible = this.active;
	}
}
