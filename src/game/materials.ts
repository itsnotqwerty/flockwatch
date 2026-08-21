import type { Player, ScrapComponent } from "../types.ts";

export const MATERIAL_NAMES: Record<ScrapComponent, string> = {
  lens: "optical lens",
  housing: "reinforced housing",
  wiring: "copper wiring",
  circuit_board: "circuit board",
  power_cell: "power cell",
  signal_crystal: "signal crystal",
  ballistic_fiber: "ballistic fiber",
  chemical_reagent: "chemical reagent",
};

export type MaterialBundle = Partial<Record<ScrapComponent, number>>;

export function addMaterials(
  player: Player,
  materials: MaterialBundle | undefined,
): Player {
  if (!materials) return player;
  const scrap = { ...player.scrap };
  for (const [material, amount] of Object.entries(materials)) {
    const key = material as ScrapComponent;
    scrap[key] = (scrap[key] ?? 0) + (amount ?? 0);
  }
  return { ...player, scrap };
}

export function formatMaterials(materials: MaterialBundle): string {
  return Object.entries(materials)
    .filter(([, amount]) => (amount ?? 0) > 0)
    .map(([material, amount]) =>
      `${amount} ${MATERIAL_NAMES[material as ScrapComponent] ?? material}`
    )
    .join(", ");
}
