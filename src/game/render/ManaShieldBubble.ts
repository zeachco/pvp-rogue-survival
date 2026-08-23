import * as THREE from "three";

export function createManaShieldBubble(
	radius: number,
	owner: "hero" | "enemy",
): THREE.Mesh {
	const bubble = new THREE.Mesh(
		new THREE.SphereGeometry(radius * 1.35, 24, 16),
		new THREE.MeshBasicMaterial({
			color: owner === "hero" ? 0x58d8ff : 0xff678f,
			transparent: true,
			opacity: 0.18,
			depthWrite: false,
			side: THREE.DoubleSide,
		}),
	);
	bubble.name = "mana-shield-bubble";
	bubble.position.z = radius * 0.35;
	bubble.renderOrder = 20;
	bubble.visible = false;
	return bubble;
}
