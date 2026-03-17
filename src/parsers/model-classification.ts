export function classifyModel(modelPath: string): number {
  const p = modelPath.toLowerCase();

  if (
    p.includes("tree") ||
    p.includes("bush") ||
    p.includes("forest") ||
    p.includes("palm") ||
    p.includes("plant") ||
    p.includes("ficus") ||
    p.includes("shrub")
  ) {
    return 0;
  }

  if (p.includes("rock") || p.includes("stone") || p.includes("boulder") || p.includes("cliff")) {
    return 2;
  }

  if (
    p.includes("nav_pier") ||
    p.includes("pier") ||
    p.includes("dock") ||
    p.includes("quay") ||
    p.includes("runway") ||
    p.includes("taxiway") ||
    p.includes("helipad") ||
    p.includes("platform") ||
    p.includes("conveyer")
  ) {
    return 6;
  }

  if (
    p.includes("wall") ||
    p.includes("fence") ||
    p.includes("gate") ||
    p.includes("bridge") ||
    p.includes("dam") ||
    p.includes("pavement") ||
    p.includes("sidewalk") ||
    p.includes("sw_") ||
    p.includes("kerb") ||
    p.includes("rail") ||
    p.includes("quarry") ||
    p.includes("ruin") ||
    p.includes("plot_") ||
    p.includes("pletivo")
  ) {
    return 3;
  }

  if (
    p.includes("sign") ||
    p.includes("lamp") ||
    p.includes("light") ||
    p.includes("pole") ||
    p.includes("powerline") ||
    p.includes("wire") ||
    p.includes("antenna") ||
    p.includes("cable") ||
    p.includes("billboard")
  ) {
    return 4;
  }

  if (
    p.includes("haybale") ||
    p.includes("woodpile") ||
    p.includes("timberpile") ||
    p.includes("timberlog") ||
    p.includes("strawstack") ||
    p.includes("hutch_") ||
    p.includes("lavicka") ||
    p.includes("bench") ||
    p.includes("edgelight") ||
    p.includes("misc_concrete") ||
    p.includes("crane_rail")
  ) {
    return 10;
  }

  if (
    p.includes("house") ||
    p.includes("build") ||
    p.includes("barrack") ||
    p.includes("tower") ||
    p.includes("factory") ||
    p.includes("church") ||
    p.includes("mosque") ||
    p.includes("school") ||
    p.includes("shop") ||
    p.includes("hospital") ||
    p.includes("castle") ||
    p.includes("hangar") ||
    p.includes("barn") ||
    p.includes("shed") ||
    p.includes("garage") ||
    p.includes("hut") ||
    p.includes("bunker") ||
    p.includes("mil_") ||
    p.includes("ind_") ||
    p.includes("cargo") ||
    p.includes("crane") ||
    p.includes("complex") ||
    p.includes("clinic") ||
    p.includes("kiosk") ||
    p.includes("market") ||
    p.includes("shelter") ||
    p.includes("mausoleum") ||
    p.includes("construction") ||
    p.includes("tank_") ||
    p.includes("watertank") ||
    p.includes("fuel_tank") ||
    p.includes("transformer") ||
    p.includes("greenhouse") ||
    p.includes("station") ||
    p.includes("bouda")
  ) {
    if (
      p.includes("house_2") ||
      p.includes("house_3") ||
      p.includes("tower") ||
      p.includes("church") ||
      p.includes("mosque") ||
      p.includes("hospital") ||
      p.includes("castle") ||
      p.includes("mausoleum") ||
      p.includes("school") ||
      p.includes("barrack") ||
      p.includes("factory") ||
      p.includes("hotel") ||
      p.includes("complex")
    ) {
      return 7;
    }

    if (
      p.includes("ind_") ||
      p.includes("hangar") ||
      p.includes("warehouse") ||
      p.includes("factory") ||
      p.includes("cargo") ||
      p.includes("crane") ||
      p.includes("fuel_tank") ||
      p.includes("watertank") ||
      p.includes("transformer") ||
      p.includes("construction") ||
      p.includes("greenhouse")
    ) {
      return 9;
    }

    if (
      p.includes("shed") ||
      p.includes("hut") ||
      p.includes("garage") ||
      p.includes("bouda") ||
      p.includes("kiosk") ||
      p.includes("shelter") ||
      p.includes("tank_")
    ) {
      return 8;
    }

    return 1;
  }

  return 5;
}
