import { MockDriver } from "@opennest/devices";
import type { Device } from "@opennest/vm";

export interface PlaygroundFixture {
  driver: MockDriver;
  devices: Device[];
}

export async function createPlaygroundDevices(): Promise<PlaygroundFixture> {
  const driver = new MockDriver();
  await driver.init({});

  const specs: {
    id: string;
    type: string;
    room: string;
    name: string;
    initialState: Record<string, unknown>;
  }[] = [
    { id: "tv_salon", type: "tv", room: "salon", name: "Salon TV", initialState: { power: false, volume: 15, source: "hdmi1", channel: 1 } },
    { id: "tv_salon_2", type: "tv", room: "salon", name: "Salon TV 2", initialState: { power: false, volume: 20, source: "netflix", channel: 42 } },
    { id: "tv_chambre", type: "tv", room: "chambre", name: "Chambre TV", initialState: { power: false, volume: 10, source: "tv", channel: 7 } },
    { id: "light_salon_1", type: "light", room: "salon", name: "Plafonnier Salon", initialState: { power: false, brightness: 80, color: "warm_white", mode: "normal" } },
    { id: "light_salon_2", type: "light", room: "salon", name: "Lampe Salon", initialState: { power: true, brightness: 40, color: "yellow", mode: "reading" } },
    { id: "light_chambre", type: "light", room: "chambre", name: "Plafonnier Chambre", initialState: { power: false, brightness: 100, color: "white", mode: "normal" } },
    { id: "thermostat_salon", type: "thermostat", room: "salon", name: "Thermostat Salon", initialState: { temperature: 21 } },
    { id: "speaker_salon", type: "speaker", room: "salon", name: "Enceinte Salon", initialState: { power: false, volume: 30 } },
    { id: "speaker_chambre", type: "speaker", room: "chambre", name: "Enceinte Chambre", initialState: { power: false, volume: 20 } },
    { id: "vacuum_salon", type: "vacuum", room: "salon", name: "Aspirateur Salon", initialState: {} },
    { id: "camera_entree", type: "camera", room: "entrée", name: "Caméra Entrée", initialState: {} },
    { id: "door_entree", type: "door", room: "entrée", name: "Porte Entrée", initialState: { state: "unlocked" } },
    { id: "fan_chambre", type: "fan", room: "chambre", name: "Ventilateur Chambre", initialState: { power: false, speed: 1 } },
    { id: "switch_entree", type: "switch", room: "entrée", name: "Interrupteur Entrée", initialState: { power: false } },
  ];

  for (const spec of specs) {
    driver.seed(spec.id, spec.initialState);
  }

  const devices: Device[] = specs.map((spec) => ({
    id: spec.id,
    type: spec.type,
    room: spec.room,
    name: spec.name,
    driver,
    driverConfig: {},
  }));

  return { driver, devices };
}
