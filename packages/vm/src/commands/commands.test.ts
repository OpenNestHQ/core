import { describe, it, expect } from "vitest";
import {
  parseHomeDSL,
  buildAction,
  buildAssignment,
  buildQuery,
  buildIncrement,
  buildProgram,
} from "@opennest/lang-core";
import type { PowerValue } from "@opennest/lang-core";
import { MockDriver } from "@opennest/devices";
import {
  executeCommand,
  createSession,
  ConfirmationPolicy,
} from "../index.js";
import type { Device, Session, VMCommand } from "../index.js";
import { resumeWithResponse } from "../state.js";

function makeDriver(): MockDriver {
  return new MockDriver();
}

async function makeDevice(
  id: string,
  type: string,
  room: string,
  name: string,
  driver: MockDriver,
  initialState: Record<string, unknown> = {},
): Promise<Device> {
  await driver.init({});
  driver.seed(id, initialState);
  return {
    id,
    type,
    room,
    name,
    driver,
    driverConfig: {},
  };
}

async function devices(): Promise<Device[]> {
  const driver = makeDriver();
  return Promise.all([
    makeDevice("tv_salon", "tv", "salon", "Salon TV", driver, { power: false, volume: 10 }),
    makeDevice("tv_chambre", "tv", "chambre", "Chambre TV", driver, { power: false }),
    makeDevice("light_salon", "light", "salon", "Salon Light", driver, { power: false }),
    makeDevice("vacuum_salon", "vacuum", "salon", "Salon Vacuum", driver, {}),
  ]);
}

async function devicesWithTwoLights(): Promise<Device[]> {
  const driver = makeDriver();
  return Promise.all([
    makeDevice("light_salon_1", "light", "salon", "Salon Light 1", driver, { power: false }),
    makeDevice("light_salon_2", "light", "salon", "Salon Light 2", driver, { power: false }),
  ]);
}

function on(): PowerValue {
  return { kind: "power", value: "on" };
}

function num(n: number) {
  return { kind: "number" as const, value: n };
}

function parse(code: string) {
  const result = parseHomeDSL(code);
  if (result.errors.length > 0) {
    throw new Error(
      `Parse errors: ${result.errors.map((e) => e.message).join(", ")}`,
    );
  }
  return result.program;
}

describe("executeCommand", () => {
  describe("execute_action", () => {
    it("should execute an action on an unambiguous device", async () => {
      const ctx = { devices: await devices() };
      const result = await executeCommand(
        { kind: "execute_action", action: buildAction("vacuum", "start", "salon") },
        ctx,
      );

      expect(result.status).toBe("success");
      expect(result.executed).toHaveLength(1);
      const exec = result.executed[0]!;
      expect(exec.statement.kind).toBe("action");
      expect(exec.resolvedDevices).toHaveLength(1);
      expect(exec.resolvedDevices[0]!.id).toBe("vacuum_salon");
      expect(result.session.it!.id).toBe("vacuum_salon");
    });

    it("should produce the same result as the equivalent DSL program", async () => {
      const devs = await devices();

      const commandResult = await executeCommand(
        { kind: "execute_action", action: buildAction("vacuum", "start", "salon") },
        { devices: devs },
      );

      const dslResult = await executeCommand({ kind: "run_program", program: parse("vacuum[salon].start()") }, { devices: devs },);

      expect(commandResult.status).toBe(dslResult.status);
      expect(commandResult.errors).toEqual(dslResult.errors);
      expect(commandResult.executed[0]!.statement).toEqual(
        dslResult.executed[0]!.statement,
      );
      expect(
        commandResult.executed[0]!.resolvedDevices.map((d) => d.id),
      ).toEqual(dslResult.executed[0]!.resolvedDevices.map((d) => d.id));
      expect(commandResult.session.it!.id).toBe(dslResult.session.it!.id);
    });

    it("should await device selection on ambiguity and resume with the same command", async () => {
      const ctx = { devices: await devices(), session: createSession() };
      const command: VMCommand = {
        kind: "execute_action",
        action: buildAction("tv", "turn_on"),
      };

      const first = await executeCommand(command, ctx);

      expect(first.status).toBe("awaiting_interaction");
      expect(first.interaction!.type).toBe("device_selection");

      resumeWithResponse(first.session, {
        interactionId: first.interaction!.id,
        type: "device_selection",
        deviceId: "tv_chambre",
      });

      const second = await executeCommand(command, {
        devices: ctx.devices,
        session: first.session,
      });

      expect(second.status).toBe("success");
      const exec = second.executed[second.executed.length - 1]!;
      expect(exec.resolvedDevices).toHaveLength(1);
      expect(exec.resolvedDevices[0]!.id).toBe("tv_chambre");
    });

    it("should expand wildcard rooms in batch without ambiguity", async () => {
      const ctx = { devices: await devices() };
      const result = await executeCommand(
        { kind: "execute_action", action: buildAction("tv", "turn_on", "*") },
        ctx,
      );

      expect(result.status).toBe("success");
      const exec = result.executed[0]!;
      expect(exec.resolvedDevices.map((d) => d.id).sort()).toEqual([
        "tv_chambre",
        "tv_salon",
      ]);
    });

    it("should go through the policy pipeline and pause on confirmation", async () => {
      const policy = new ConfirmationPolicy({
        requireConfirmation: (action) => action.kind === "invoke_action",
      });
      const session = createSession();
      const ctx = { devices: await devices(), session, policies: [policy] };
      const command: VMCommand = {
        kind: "execute_action",
        action: buildAction("vacuum", "start", "salon"),
      };

      const first = await executeCommand(command, ctx);

      expect(first.status).toBe("awaiting_interaction");
      expect(first.interaction!.type).toBe("confirmation");

      resumeWithResponse(first.session, {
        interactionId: first.interaction!.id,
        type: "confirmation",
        confirmed: true,
      });

      const second = await executeCommand(command, {
        devices: ctx.devices,
        session: first.session,
        policies: [policy],
      });

      expect(second.status).toBe("success");
      const exec = second.executed[second.executed.length - 1]!;
      expect(exec.resolvedDevices[0]!.id).toBe("vacuum_salon");
    });

    it("should report an error when the confirmation is denied", async () => {
      const policy = new ConfirmationPolicy({
        requireConfirmation: (action) => action.kind === "invoke_action",
      });
      const session = createSession();
      const ctx = { devices: await devices(), session, policies: [policy] };
      const command: VMCommand = {
        kind: "execute_action",
        action: buildAction("vacuum", "start", "salon"),
      };

      const first = await executeCommand(command, ctx);
      expect(first.status).toBe("awaiting_interaction");

      resumeWithResponse(first.session, {
        interactionId: first.interaction!.id,
        type: "confirmation",
        confirmed: false,
      });

      const second = await executeCommand(command, {
        devices: ctx.devices,
        session: first.session,
        policies: [policy],
      });

      expect(second.status).toBe("error");
      expect(second.errors[0]!.message).toContain("confirmation");
    });

    it("should report an error when no device matches", async () => {
      const ctx = { devices: await devices() };
      const result = await executeCommand(
        { kind: "execute_action", action: buildAction("fan", "turn_on") },
        ctx,
      );

      expect(result.status).toBe("error");
      expect(result.errors).toHaveLength(1);
    });
  });

  describe("run_program", () => {
    it("should behave exactly like interpret_home_dsl", async () => {
      const devs = await devices();
      const program = parse("light[salon].power = on");

      const commandResult = await executeCommand(
        { kind: "run_program", program },
        { devices: devs },
      );

      expect(commandResult.status).toBe("success");
      expect(commandResult.executed[0]!.changes[0]!.newValue).toBe(true);
    });

    it("should accept programs built with buildProgram", async () => {
      const devs = await devices();
      const program = buildProgram([buildAction("vacuum", "start", "salon")]);

      const result = await executeCommand(
        { kind: "run_program", program },
        { devices: devs },
      );

      expect(result.status).toBe("success");
    });
  });

  describe("execute_statement", () => {
    it("should execute an assignment identically to the DSL", async () => {
      const devs = await devices();

      const commandResult = await executeCommand(
        {
          kind: "execute_statement",
          statement: buildAssignment("light", "power", on(), "salon"),
        },
        { devices: devs },
      );

      const dslResult = await executeCommand({ kind: "run_program", program: parse("light[salon].power = on") }, { devices: devs },);

      expect(commandResult.status).toBe("success");
      expect(commandResult.executed[0]!.statement).toEqual(
        dslResult.executed[0]!.statement,
      );
      expect(commandResult.executed[0]!.changes[0]!.newValue).toBe(true);
      expect(commandResult.session.it!.id).toBe("light_salon");
    });

    it("should execute a query", async () => {
      const ctx = { devices: await devices() };
      const result = await executeCommand(
        {
          kind: "execute_statement",
          statement: buildQuery("tv", "volume", "salon"),
        },
        ctx,
      );

      expect(result.status).toBe("success");
      const change = result.executed[0]!.changes[0]!;
      expect(change.property).toBe("volume");
      expect(change.newValue).toBe(10);
    });

    it("should execute an increment", async () => {
      const ctx = { devices: await devices() };
      const result = await executeCommand(
        {
          kind: "execute_statement",
          statement: buildIncrement("tv", "volume", num(5), "salon"),
        },
        ctx,
      );

      expect(result.status).toBe("success");
      const change = result.executed[0]!.changes[0]!;
      expect(change.oldValue).toBe(10);
      expect(change.newValue).toBe(15);
    });

    it("should be equivalent to execute_action when carrying an action statement", async () => {
      const devs = await devices();
      const action = buildAction("vacuum", "start", "salon");

      const viaStatement = await executeCommand(
        { kind: "execute_statement", statement: action },
        { devices: devs },
      );
      const viaAction = await executeCommand(
        { kind: "execute_action", action },
        { devices: devs },
      );

      expect(viaStatement.status).toBe(viaAction.status);
      expect(viaStatement.executed[0]!.statement).toEqual(
        viaAction.executed[0]!.statement,
      );
      expect(
        viaStatement.executed[0]!.resolvedDevices.map((d) => d.id),
      ).toEqual(viaAction.executed[0]!.resolvedDevices.map((d) => d.id));
    });

    it("should await device selection on ambiguity and resume with the same command", async () => {
      const ctx = { devices: await devices(), session: createSession() };
      const command: VMCommand = {
        kind: "execute_statement",
        statement: buildAssignment("tv", "power", on()),
      };

      const first = await executeCommand(command, ctx);

      expect(first.status).toBe("awaiting_interaction");
      expect(first.interaction!.type).toBe("device_selection");

      resumeWithResponse(first.session, {
        interactionId: first.interaction!.id,
        type: "device_selection",
        deviceId: "tv_chambre",
      });

      const second = await executeCommand(command, {
        devices: ctx.devices,
        session: first.session,
      });

      expect(second.status).toBe("success");
      const exec = second.executed[second.executed.length - 1]!;
      expect(exec.resolvedDevices[0]!.id).toBe("tv_chambre");
    });

    it("should go through the policy pipeline for set_property", async () => {
      const policy = new ConfirmationPolicy({
        requireConfirmation: (action) => action.kind === "set_property",
      });
      const session = createSession();
      const ctx = { devices: await devices(), session, policies: [policy] };
      const command: VMCommand = {
        kind: "execute_statement",
        statement: buildAssignment("light", "power", on(), "salon"),
      };

      const first = await executeCommand(command, ctx);

      expect(first.status).toBe("awaiting_interaction");
      expect(first.interaction!.type).toBe("confirmation");

      resumeWithResponse(first.session, {
        interactionId: first.interaction!.id,
        type: "confirmation",
        confirmed: true,
      });

      const second = await executeCommand(command, {
        devices: ctx.devices,
        session: first.session,
        policies: [policy],
      });

      expect(second.status).toBe("success");
      const exec = second.executed[second.executed.length - 1]!;
      expect(exec.changes[0]!.newValue).toBe(true);
    });
  });

  describe("deviceId targeting", () => {
    it("should bypass ambiguity by targeting a specific device", async () => {
      const ctx = { devices: await devicesWithTwoLights() };
      const result = await executeCommand(
        {
          kind: "execute_statement",
          statement: buildAssignment("light", "power", on(), "salon"),
          deviceId: "light_salon_2",
        },
        ctx,
      );

      expect(result.status).toBe("success");
      const exec = result.executed[0]!;
      expect(exec.resolvedDevices).toHaveLength(1);
      expect(exec.resolvedDevices[0]!.id).toBe("light_salon_2");
      expect(result.session.it!.id).toBe("light_salon_2");
    });

    it("should work with execute_action", async () => {
      const ctx = { devices: await devices() };
      const result = await executeCommand(
        {
          kind: "execute_action",
          action: buildAction("tv", "turn_on"),
          deviceId: "tv_chambre",
        },
        ctx,
      );

      expect(result.status).toBe("success");
      expect(result.executed[0]!.resolvedDevices[0]!.id).toBe("tv_chambre");
    });

    it("should report an error for an unknown deviceId", async () => {
      const ctx = { devices: await devices() };
      const result = await executeCommand(
        {
          kind: "execute_statement",
          statement: buildAssignment("light", "power", on(), "salon"),
          deviceId: "does_not_exist",
        },
        ctx,
      );

      expect(result.status).toBe("error");
      expect(result.errors).toHaveLength(1);
    });

    it("should report an error when deviceId does not match the statement type", async () => {
      const ctx = { devices: await devices() };
      const result = await executeCommand(
        {
          kind: "execute_statement",
          statement: buildAssignment("light", "power", on()),
          deviceId: "tv_salon",
        },
        ctx,
      );

      expect(result.status).toBe("error");
    });

    it("should still trigger policies when targeting by deviceId", async () => {
      const policy = new ConfirmationPolicy({
        requireConfirmation: (action) => action.kind === "set_property",
      });
      const ctx = {
        devices: await devicesWithTwoLights(),
        session: createSession(),
        policies: [policy],
      };

      const result = await executeCommand(
        {
          kind: "execute_statement",
          statement: buildAssignment("light", "power", on(), "salon"),
          deviceId: "light_salon_1",
        },
        ctx,
      );

      expect(result.status).toBe("awaiting_interaction");
      expect(result.interaction!.type).toBe("confirmation");
    });
  });

  describe("resume_interaction", () => {
    it("should pause and resume execution through the VM command", async () => {
      const policy = new ConfirmationPolicy({
        requireConfirmation: (action) => action.kind === "invoke_action",
      });
      const session = createSession();
      const ctx = { devices: await devices(), session, policies: [policy] };

      // Start execution — pauses for confirmation
      const first = await executeCommand(
        { kind: "execute_action", action: buildAction("vacuum", "start", "salon") },
        ctx,
      );
      expect(first.status).toBe("awaiting_interaction");
      expect(first.interaction!.type).toBe("confirmation");

      // Resume via VM command
      const second = await executeCommand(
        {
          kind: "resume_interaction",
          response: {
            interactionId: first.interaction!.id,
            type: "confirmation",
            confirmed: true,
          },
        },
        { devices: ctx.devices, session: first.session, policies: ctx.policies },
      );

      expect(second.status).toBe("success");
      const exec = second.executed[second.executed.length - 1]!;
      expect(exec.resolvedDevices[0]!.id).toBe("vacuum_salon");
    });

    it("should resume after device selection ambiguity", async () => {
      const ctx = { devices: await devices(), session: createSession() };

      // Start — ambiguous, pauses for device selection
      const first = await executeCommand(
        { kind: "execute_action", action: buildAction("tv", "turn_on") },
        ctx,
      );
      expect(first.status).toBe("awaiting_interaction");
      expect(first.interaction!.type).toBe("device_selection");

      // Resume via VM command
      const second = await executeCommand(
        {
          kind: "resume_interaction",
          response: {
            interactionId: first.interaction!.id,
            type: "device_selection",
            deviceId: "tv_salon",
          },
        },
        { devices: ctx.devices, session: first.session },
      );

      expect(second.status).toBe("success");
      const exec = second.executed[second.executed.length - 1]!;
      expect(exec.resolvedDevices[0]!.id).toBe("tv_salon");
    });

    it("should error when resuming without a pending program", async () => {
      const ctx = { devices: await devices(), session: createSession() };
      await expect(
        executeCommand(
          {
            kind: "resume_interaction",
            response: {
              interactionId: "x",
              type: "confirmation",
              confirmed: true,
            },
          },
          ctx,
        ),
      ).rejects.toThrow("no pending");
    });
  });

  describe("cancel_execution", () => {
    it("should reset the session", async () => {
      const session = createSession();
      const ctx = { devices: await devices(), session };

      const result = await executeCommand(
        { kind: "cancel_execution" },
        ctx,
      );

      expect(result.status).toBe("success");
      expect(result.executed).toEqual([]);
      expect(result.session.history).toEqual([]);
      expect(result.session.it).toBeNull();
    });

    it("should discard a pending interaction", async () => {
      const ctx = { devices: await devices(), session: createSession() };

      const first = await executeCommand(
        { kind: "execute_action", action: buildAction("tv", "turn_on") },
        ctx,
      );
      expect(first.status).toBe("awaiting_interaction");

      const cancelled = await executeCommand(
        { kind: "cancel_execution" },
        { devices: ctx.devices, session: first.session },
      );

      expect(cancelled.status).toBe("success");
      expect(cancelled.session.pendingInteraction).toBeNull();
      expect(cancelled.session._pendingProgram).toBeUndefined();
    });
  });

  describe("session continuity", () => {
    it("should share it context between DSL programs and commands", async () => {
      const devs = await devices();
      const session: Session = createSession();

      const dslResult = await executeCommand({ kind: "run_program", program: parse("light[salon].power = on") }, {
        devices: devs,
        session,
      });
      expect(dslResult.session.it!.id).toBe("light_salon");

      const commandResult = await executeCommand(
        { kind: "execute_action", action: buildAction("vacuum", "start", "salon") },
        { devices: devs, session: dslResult.session },
      );

      expect(commandResult.status).toBe("success");
      expect(commandResult.session.it!.id).toBe("vacuum_salon");
      expect(commandResult.session.history).toHaveLength(2);
    });
  });
});
