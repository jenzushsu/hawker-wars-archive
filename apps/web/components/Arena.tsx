"use client";

import { useEffect, useRef, useState } from "react";
import type Phaser from "phaser";
import {
  hawkerFrameName,
  HAWKER_SKINS,
} from "../../../packages/art/src/hawker";
import {
  selectHawkerClip,
  clipFrame,
  type HawkerObservation,
} from "../lib/animation";

import {
  CUSTOMER_SKINS,
  customerFrameName,
} from "../../../packages/art/src/customer";
import {
  ENVIRONMENT_LAYOUT,
  environmentFrameName,
} from "../../../packages/art/src/environment";
import { projectCustomers } from "../lib/customers";
import type { DemoCustomerActivity, DemoEffect } from "../lib/demo";
import { projectEffects } from "../lib/effects";
import { effectFrameName } from "../../../packages/art/src/effects";
export interface ArenaProps extends HawkerObservation {
  /** Live scenes show one selected policy, not three mirrored competitors. */
  singleStall?: boolean;
  customers: DemoCustomerActivity;
  delivered: boolean;
  effects: DemoEffect[];
  servedTotal: number;
  sceneId: string;
  tick: number;
  paused: boolean;
  reducedMotion: boolean;
  queue: number;
  cooking: boolean;
}

const WIDTH = 480,
  HEIGHT = 240;
const STALLS = ENVIRONMENT_LAYOUT.stallOrigins.map((x) => ({ x }));

/** Renderer only: props drive a presentation clock; no frame callback changes simulation state. */
export default function Arena(props: ArenaProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const latest = useRef(props);
  latest.current = props;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    let game: Phaser.Game | undefined;
    let observer: ResizeObserver | undefined;
    const fit = () => {
      if (!game?.canvas || !host.clientWidth || !host.clientHeight) return;
      const ratio = Math.min(
        host.clientWidth / WIDTH,
        host.clientHeight / HEIGHT,
      );
      const scale = ratio >= 1 ? Math.floor(ratio) : Math.max(0.1, ratio);
      Object.assign(game.canvas.style, {
        width: `${WIDTH * scale}px`,
        height: `${HEIGHT * scale}px`,
        position: "absolute",
        left: "50%",
        top: "50%",
        transform: "translate(-50%, -50%)",
        imageRendering: "pixelated",
      });
      game.canvas.setAttribute("aria-hidden", "true");
      game.canvas.setAttribute("role", "presentation");
    };
    void import("phaser")
      .then((module) => {
        if (cancelled) return;
        const Phaser = module.default;
        class HawkerScene extends Phaser.Scene {
          private crew: Phaser.GameObjects.Sprite[] = [];
          private presentationMs = 0;
          private identity = "";
          private lastClip = "";
          private lastHawkerFrame = -1;
          private customers: Phaser.GameObjects.Sprite[][] = [];
          private lastCustomerPoses = "";
          private effects: Phaser.GameObjects.Sprite[][] = [];
          private lastEffects = "";
          private lastTick = -1;
          private lastQueue = -1;
          private lastCooking: boolean | undefined;
          private lastReducedMotion: boolean | undefined;
          preload() {
            this.load.atlas("effects", "/art/effects.png", "/art/effects.json");
            this.load.atlas("hawkers", "/art/hawker.png", "/art/hawker.json");
            this.load.atlas(
              "customers",
              "/art/customer.png",
              "/art/customer.json",
            );
            this.load.atlas(
              "environment",
              "/art/environment.png",
              "/art/environment.json",
            );
          }
          create() {
            if (
              !["hawkers", "customers", "environment", "effects"].every((key) =>
                this.textures.exists(key),
              )
            ) {
              setFailed(true);
              host!.dataset.arenaState = "unavailable";
              return;
            }
            this.add
              .image(0, 0, "environment", environmentFrameName("background"))
              .setOrigin(0)
              .setDepth(0);
            this.crew = STALLS.map((stall, index) =>
              this.add
                .sprite(
                  stall.x + 58,
                  112, // Feet remain behind the counter; serving hands meet its top.
                  "hawkers",
                  hawkerFrameName(HAWKER_SKINS[index]!, "idle", 0),
                )
                .setOrigin(0.5, 1)
                .setDepth(10),
            );
            this.add
              .image(0, 0, "environment", environmentFrameName("counters"))
              .setOrigin(0)
              .setDepth(20);
            this.customers = STALLS.map(() =>
              Array.from({ length: 6 }, () =>
                this.add
                  .sprite(
                    0,
                    0,
                    "customers",
                    customerFrameName("terracotta", "wait", "down", 0),
                  )
                  .setOrigin(0.5, 1)
                  .setDepth(30)
                  .setVisible(false),
              ),
            );
            this.add
              .image(0, 0, "environment", environmentFrameName("foreground"))
              .setOrigin(0)
              .setDepth(40);
            this.effects = STALLS.map(() =>
              Array.from({ length: 7 }, () =>
                this.add
                  .sprite(0, 0, "effects", effectFrameName("steam", 0))
                  .setOrigin(0.5, 1)
                  .setDepth(50)
                  .setVisible(false),
              ),
            );
            host!.dataset.effectsReady = "true";
            host!.dataset.environmentReady = "true";
            host!.dataset.arenaState = "ready";
            fit();
          }
          update(_time: number, delta: number) {
            const current = latest.current;
            if (!this.crew.length) return;
            const identity = `${current.sceneId}:${current.tick}`;
            if (identity !== this.identity) {
              this.identity = identity;
              this.presentationMs = 0;
            } else if (!current.paused && !current.reducedMotion)
              this.presentationMs += Math.min(delta, 100);
            const clip = selectHawkerClip(current);
            const hawkerFrame = clipFrame(
              clip,
              this.presentationMs,
              current.reducedMotion,
            );
            host!.dataset.clip = clip;
            host!.dataset.frame = String(hawkerFrame);
            host!.dataset.frameName = hawkerFrameName(
              "green",
              clip,
              hawkerFrame,
            );
            host!.dataset.presentationTime = String(
              Math.floor(this.presentationMs),
            );
            const tick = Number.isFinite(current.tick)
              ? Math.max(0, Math.floor(current.tick))
              : 0;
            const effects = projectEffects(
              { ...current, received: current.customers.received },
              this.presentationMs,
              current.reducedMotion,
            );
            const effectKey = JSON.stringify(effects);
            host!.dataset.effectPoses = effectKey;
            const queue = Number.isFinite(current.queue)
              ? Math.min(30, Math.max(0, Math.floor(current.queue)))
              : 0;
            const poses = projectCustomers(
              current.customers,
              current.servedTotal,
              this.presentationMs,
              current.reducedMotion,
            );
            const customerKey = JSON.stringify(poses);
            host!.dataset.customerPoses = customerKey;
            host!.dataset.receivedCount = String(current.customers.received);
            host!.dataset.departedCount = String(current.customers.departed);
            if (
              customerKey === this.lastCustomerPoses &&
              effectKey === this.lastEffects &&
              clip === this.lastClip &&
              hawkerFrame === this.lastHawkerFrame &&
              tick === this.lastTick &&
              queue === this.lastQueue &&
              current.cooking === this.lastCooking &&
              current.reducedMotion === this.lastReducedMotion
            )
              return;
            this.lastCustomerPoses = customerKey;
            this.lastClip = clip;
            this.lastHawkerFrame = hawkerFrame;
            this.lastEffects = effectKey;
            this.lastTick = tick;
            this.lastQueue = queue;
            this.lastCooking = current.cooking;
            this.lastReducedMotion = current.reducedMotion;
            for (const [index, stall] of STALLS.entries()) {
              const visible = !current.singleStall || index === 1;
              this.crew[index]!.setVisible(visible);
              if (!visible) {
                this.customers[index]!.forEach(sprite => sprite.setVisible(false));
                this.effects[index]!.forEach(sprite => sprite.setVisible(false));
                continue;
              }
              this.crew[index]!.setFrame(
                hawkerFrameName(HAWKER_SKINS[index]!, clip, hawkerFrame),
              );
              this.customers[index]!.forEach((sprite) =>
                sprite.setVisible(false),
              );
              for (const [slot, pose] of poses.entries()) {
                const seat = ENVIRONMENT_LAYOUT.seatedCustomerAnchors[index]!;
                const x =
                  pose.role === "eat"
                    ? seat.x
                    : pose.role === "queue"
                      ? stall.x + 63 + (pose.slot % 2 ? 8 : -3)
                      : pose.role === "receive"
                        ? stall.x + 96
                        : stall.x + 113;
                const y =
                  pose.role === "eat"
                    ? seat.feetY
                    : pose.role === "queue"
                      ? 162 + pose.slot * 13
                      : pose.role === "receive"
                        ? 157
                        : 179;
                const skinIndex =
                  pose.role === "eat"
                    ? seat.variant
                    : (index * 2 +
                        pose.slot +
                        (pose.role === "receive" ? 3 : 0)) %
                      CUSTOMER_SKINS.length;
                this.customers[index]![slot]!.setFrame(
                  customerFrameName(
                    CUSTOMER_SKINS[skinIndex]!,
                    pose.clip,
                    pose.direction,
                    pose.frame,
                  ),
                )
                  .setPosition(x + pose.offsetX, y + pose.offsetY)
                  .setDepth(pose.role === "eat" ? 35 : 30)
                  .setVisible(true);
              }
              this.effects[index]!.forEach((sprite) =>
                sprite.setVisible(false),
              );
              for (const [slot, effect] of effects.entries()) {
                const anchor =
                  effect.clip === "steam"
                    ? [stall.x + 20, 91]
                    : effect.clip === "service"
                      ? [stall.x + 96, 126]
                      : effect.clip === "shortage"
                        ? [stall.x + 60, 135]
                        : effect.clip === "delivery"
                          ? [stall.x + 26, 150]
                          : [stall.x + 120, 104];
                this.effects[index]![slot]!.setFrame(
                  effectFrameName(effect.clip, effect.frame),
                )
                  .setPosition(anchor[0]!, anchor[1]!)
                  .setVisible(true);
              }
            }
          }
        }
        game = new Phaser.Game({
          type: Phaser.CANVAS,
          width: WIDTH,
          height: HEIGHT,
          parent: host,
          backgroundColor: "#d3c39d",
          transparent: false,
          pixelArt: true,
          roundPixels: true,
          antialias: false,
          scene: HawkerScene,
          scale: { mode: Phaser.Scale.NONE, width: WIDTH, height: HEIGHT },
          banner: false,
          audio: { noAudio: true },
          fps: { target: 30, forceSetTimeOut: false },
        });
        observer = new ResizeObserver(fit);
        observer.observe(host);
        fit();
      })
      .catch(() => {
        if (!cancelled) {
          host.dataset.arenaState = "unavailable";
          setFailed(true);
        }
      });
    return () => {
      cancelled = true;
      observer?.disconnect();
      game?.destroy(true);
    };
  }, []);

  return (
    <div
      ref={hostRef}
      className="arena-canvas"
      data-arena-state={failed ? "unavailable" : "loading"}
      aria-hidden={failed ? undefined : true}
      style={{
        position: "absolute",
        inset: 0,
        overflow: "hidden",
        background: "#d3c39d",
        display: "grid",
        placeItems: "center",
      }}
    >
      {failed ? (
        <p
          role="status"
          style={{
            color: "#443f34",
            textAlign: "center",
            maxWidth: "30ch",
            padding: "24px",
            fontSize: "16px",
            lineHeight: 1.5,
          }}
        >
          The arena is unavailable. Scores and decisions remain available below.
        </p>
      ) : null}
    </div>
  );
}
