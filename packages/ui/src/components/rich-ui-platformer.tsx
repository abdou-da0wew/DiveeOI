import { createMemo, createSignal, createUniqueId, For, Show } from "solid-js"
import type { ChatUIPlatformerComponent } from "@diveeoi/db/chat-ui"
import { createPlatformerState, simulatePlatformer, type PlatformerAction } from "./rich-ui-platformer-engine"

const themes = {
  neon: {
    skyTop: "#111B3B",
    skyBottom: "#263B59",
    platform: "#297F9C",
    platformDark: "#172E54",
    accent: "#67E8F9",
    player: "#60A5FA",
    playerLight: "#BAF6FF",
    coin: "#FACC15",
    hazard: "#FB7185",
    goal: "#FDE68A",
    ridge: "#31466E",
  },
  sky: {
    skyTop: "#B9E3F8",
    skyBottom: "#E9F6FF",
    platform: "#4B9B72",
    platformDark: "#28654D",
    accent: "#DCFCE7",
    player: "#2563EB",
    playerLight: "#DBEAFE",
    coin: "#F59E0B",
    hazard: "#DC2626",
    goal: "#FBBF24",
    ridge: "#75A9C7",
  },
  forest: {
    skyTop: "#102D2A",
    skyBottom: "#315B4B",
    platform: "#477B50",
    platformDark: "#254A35",
    accent: "#A7F3D0",
    player: "#A78BFA",
    playerLight: "#E9D5FF",
    coin: "#FDE047",
    hazard: "#FB7185",
    goal: "#FDE68A",
    ridge: "#37634F",
  },
}

export function RichUIPlatformer(props: { component: ChatUIPlatformerComponent }) {
  const uid = createUniqueId().replace(/[^a-zA-Z0-9_-]/g, "")
  const [game, setGame] = createSignal(createPlatformerState(props.component))
  const [frames, setFrames] = createSignal(6)
  const palette = () => themes[props.component.theme]
  const ended = () => game().won || game().gameOver
  const lives = () => Math.max(0, props.component.physics.maxLives - game().deaths)
  const player = () => ({
    ...props.component.player,
    x: game().x,
    y: game().y,
  })
  const status = createMemo(() => {
    if (game().won) return "LEVEL COMPLETE"
    if (game().gameOver) return "GAME OVER"
    if (game().grounded) return "ON THE GROUND"
    if (game().doubleJumpReady) return "DOUBLE JUMP READY"
    return "AIRBORNE"
  })
  const advance = (action: PlatformerAction) => {
    setGame((current) => simulatePlatformer(props.component, current, action, frames()))
  }
  const restart = () => setGame(createPlatformerState(props.component))
  const canJump = () => game().grounded || game().doubleJumpReady

  return (
    <section class="flex min-w-0 flex-col gap-3">
      <div class="flex min-w-0 items-start justify-between gap-3">
        <div class="min-w-0">
          <h3 class="text-14-semibold text-text-strong">{props.component.title}</h3>
          <Show when={props.component.description}>
            <p class="mt-1 text-12-regular leading-relaxed text-text-weak">{props.component.description}</p>
          </Show>
        </div>
        <span
          class="shrink-0 rounded-full px-2.5 py-1 text-9-semibold tracking-wide"
          classList={{
            "bg-icon-success-base/10 text-icon-success-base": game().won,
            "bg-icon-danger-base/10 text-icon-danger-base": game().gameOver,
            "bg-background-base text-text-weak": !ended(),
          }}
        >
          {game().won ? "VICTORY" : game().gameOver ? "DEFEAT" : "PLAYING"}
        </span>
      </div>

      <div class="grid grid-cols-3 gap-3 border-y border-border-weak-base py-2.5">
        <div class="min-w-0">
          <div class="text-9-medium uppercase tracking-wide text-text-weak">Crystals</div>
          <div class="mt-0.5 text-17-semibold tabular-nums text-text-strong">
            <span style={{ color: palette().coin }}>{game().collected.length}</span>
            <span class="text-11-regular text-text-weak"> / {props.component.collectibles.length}</span>
          </div>
        </div>
        <div class="min-w-0">
          <div class="text-9-medium uppercase tracking-wide text-text-weak">Lives</div>
          <div class="mt-0.5 text-17-semibold tabular-nums text-text-strong">{lives()} / {props.component.physics.maxLives}</div>
        </div>
        <div class="min-w-0">
          <div class="text-9-medium uppercase tracking-wide text-text-weak">Checkpoint</div>
          <div class="mt-0.5 truncate text-12-semibold text-text-strong">{game().checkpointID ? "ACTIVE" : "OFF"}</div>
        </div>
      </div>

      <div class="overflow-hidden rounded-xl border border-border-weak-base">
        <svg
          viewBox={`0 0 ${props.component.width} ${props.component.height}`}
          role="img"
          aria-label={`Playable 2D platformer: ${props.component.title}`}
          class="block h-auto w-full"
        >
          <defs>
            <linearGradient id={`platformer-sky-${uid}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color={palette().skyTop}/>
              <stop offset="100%" stop-color={palette().skyBottom}/>
            </linearGradient>
            <linearGradient id={`platformer-ground-${uid}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color={palette().platform}/>
              <stop offset="100%" stop-color={palette().platformDark}/>
            </linearGradient>
            <linearGradient id={`platformer-player-${uid}`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stop-color={palette().playerLight}/>
              <stop offset="100%" stop-color={palette().player}/>
            </linearGradient>
          </defs>
          <rect width={props.component.width} height={props.component.height} fill={`url(#platformer-sky-${uid})`}/>
          <circle cx={props.component.width * 0.84} cy={props.component.height * 0.17} r={props.component.height * 0.075} fill={palette().goal} opacity="0.75"/>
          <circle cx={props.component.width * 0.86} cy={props.component.height * 0.15} r={props.component.height * 0.075} fill={palette().skyTop}/>
          <path
            d={`M0 ${props.component.height * 0.72} L${props.component.width * 0.15} ${props.component.height * 0.39} L${props.component.width * 0.3} ${props.component.height * 0.68} L${props.component.width * 0.49} ${props.component.height * 0.35} L${props.component.width * 0.67} ${props.component.height * 0.7} L${props.component.width * 0.83} ${props.component.height * 0.42} L${props.component.width} ${props.component.height * 0.7} V${props.component.height} H0Z`}
            fill={palette().ridge}
            opacity="0.42"
          />
          <For each={Array.from({ length: 18 }, (_, index) => index)}>
            {(index) => (
              <circle
                cx={(index * 83 + 29) % props.component.width}
                cy={(index * 47 + 23) % Math.max(40, props.component.height * 0.5)}
                r={index % 4 === 0 ? 2 : 1.2}
                fill={palette().accent}
                opacity={props.component.theme === "sky" ? 0.18 : 0.55}
              />
            )}
          </For>

          <For each={props.component.platforms}>
            {(platform) => (
              <g>
                <rect
                  x={platform.x}
                  y={platform.y}
                  width={platform.width}
                  height={platform.height}
                  rx="3"
                  fill={`url(#platformer-ground-${uid})`}
                />
                <rect x={platform.x} y={platform.y} width={platform.width} height="4" rx="2" fill={palette().accent}/>
                <path
                  d={`M${platform.x + 10} ${platform.y + 18} h${Math.max(4, platform.width - 24)}`}
                  stroke={palette().accent}
                  stroke-opacity="0.14"
                  stroke-width="2"
                />
              </g>
            )}
          </For>

          <For each={props.component.hazards}>
            {(hazard) => {
              const spikes = Math.max(1, Math.floor(hazard.width / 18))
              return (
                <g>
                  <path
                    d={Array.from({ length: spikes }, (_, index) => {
                      const x0 = hazard.x + (hazard.width / spikes) * index
                      const x1 = hazard.x + (hazard.width / spikes) * (index + 1)
                      return `M${x0} ${hazard.y + hazard.height} L${(x0 + x1) / 2} ${hazard.y} L${x1} ${hazard.y + hazard.height} Z`
                    }).join(" ")}
                    fill={palette().hazard}
                    stroke="#FFFFFF"
                    stroke-opacity="0.35"
                    stroke-width="1.5"
                  />
                </g>
              )
            }}
          </For>

          <For each={props.component.collectibles}>
            {(coin) => (
              <Show when={!game().collected.includes(coin.id)}>
                <g>
                  <circle cx={coin.x} cy={coin.y} r="10" fill={palette().coin}/>
                  <circle cx={coin.x} cy={coin.y} r="5" fill="#FFF7C2"/>
                  <path d={`M${coin.x} ${coin.y - 7} v14`} stroke="#B7791F" stroke-width="1.2" opacity="0.6"/>
                </g>
              </Show>
            )}
          </For>

          <For each={props.component.checkpoints}>
            {(checkpoint) => (
              <g>
                <rect x={checkpoint.x} y={checkpoint.y - 30} width="4" height="30" fill={palette().playerLight}/>
                <path d={`M${checkpoint.x + 4} ${checkpoint.y - 29} l23 7 l-23 8 Z`} fill={palette().player}/>
                <circle cx={checkpoint.x + 2} cy={checkpoint.y - 31} r="3" fill={palette().playerLight}/>
                <Show when={game().checkpointID === checkpoint.id}>
                  <circle cx={checkpoint.x + 2} cy={checkpoint.y - 30} r="15" fill={palette().accent} opacity="0.2"/>
                </Show>
              </g>
            )}
          </For>

          <g>
            <rect x={props.component.goal.x} y={props.component.goal.y} width="5" height={props.component.goal.height} rx="2" fill={palette().goal}/>
            <path
              d={`M${props.component.goal.x + 5} ${props.component.goal.y + 2} l${props.component.goal.width * 0.7} 9 l-${props.component.goal.width * 0.7} 9 Z`}
              fill={palette().goal}
            />
          </g>

          <g transform={`translate(${player().x} ${player().y})`}>
            <ellipse cx={props.component.player.width / 2} cy={props.component.player.height + 4} rx={props.component.player.width * 0.65} ry="4" fill="#020617" opacity="0.35"/>
            <rect
              x="0"
              y="4"
              width={props.component.player.width}
              height={props.component.player.height - 4}
              rx="6"
              fill={`url(#platformer-player-${uid})`}
              stroke={palette().playerLight}
              stroke-width="1.5"
            />
            <rect x={props.component.player.width * 0.16} y="0" width={props.component.player.width * 0.68} height="12" rx="5" fill={palette().playerLight}/>
            <circle
              cx={game().facing === 1 ? props.component.player.width * 0.7 : props.component.player.width * 0.3}
              cy="10"
              r="2.3"
              fill="#0F172A"
            />
            <path
              d={`M${props.component.player.width * 0.28} ${props.component.player.height * 0.69} h${props.component.player.width * 0.42}`}
              stroke="#0F172A"
              stroke-width="1.8"
              stroke-linecap="round"
            />
          </g>

          <Show when={game().won || game().gameOver}>
            <rect
              x={props.component.width * 0.18}
              y={props.component.height * 0.36}
              width={props.component.width * 0.64}
              height={props.component.height * 0.25}
              rx="16"
              fill="#0F172A"
              fill-opacity="0.94"
              stroke={game().won ? palette().accent : palette().hazard}
              stroke-width="2"
            />
            <text x="50%" y={props.component.height * 0.46} text-anchor="middle" fill={game().won ? palette().accent : palette().hazard} font-size="25" font-weight="700">
              {game().won ? "LEVEL COMPLETE!" : "GAME OVER"}
            </text>
            <text x="50%" y={props.component.height * 0.53} text-anchor="middle" fill="#FFFFFF" font-size="12">
              {game().won ? `Collected ${game().collected.length} crystals` : "Try another route"}
            </text>
          </Show>
        </svg>
      </div>

      <div class="flex items-center justify-between gap-2">
        <span class="text-9-medium uppercase tracking-wide text-text-weak">Player status</span>
        <span class="text-10-semibold text-text-strong">{status()}</span>
      </div>

      <div class="flex flex-col gap-2 border-t border-border-weak-base pt-3">
        <div class="text-11-semibold text-text-strong">Movement controls</div>
        <div class="flex flex-wrap justify-center gap-2">
          <button type="button" class="min-w-24 flex-1 rounded-lg border border-border-weak-base px-3 py-2.5 text-11-semibold text-text-base hover:bg-background-base disabled:opacity-40" disabled={ended()} onClick={() => advance("left")}>◀ Left</button>
          <button type="button" class="min-w-24 flex-1 rounded-lg border border-border-weak-base px-3 py-2.5 text-11-semibold text-text-base hover:bg-background-base disabled:opacity-40" disabled={ended()} onClick={() => advance("right")}>Right ▶</button>
        </div>
        <div class="flex flex-wrap justify-center gap-2">
          <button type="button" class="min-w-20 flex-1 rounded-lg bg-text-strong px-2 py-2.5 text-10-semibold text-background-base disabled:opacity-40" disabled={ended() || !canJump()} onClick={() => advance("jump-left")}>↖ Jump</button>
          <button type="button" class="min-w-20 flex-1 rounded-lg bg-text-strong px-2 py-2.5 text-10-semibold text-background-base disabled:opacity-40" disabled={ended() || !canJump()} onClick={() => advance("jump")}>↑ Jump</button>
          <button type="button" class="min-w-20 flex-1 rounded-lg bg-text-strong px-2 py-2.5 text-10-semibold text-background-base disabled:opacity-40" disabled={ended() || !canJump()} onClick={() => advance("jump-right")}>Jump ↗</button>
        </div>
        <div class="flex flex-wrap justify-center gap-2">
          <button type="button" class="min-w-24 flex-1 rounded-lg border border-border-weak-base px-3 py-2 text-11-semibold text-text-base hover:bg-background-base disabled:opacity-40" disabled={ended() || !props.component.physics.dash || !game().dashReady} onClick={() => advance("dash")}>Dash</button>
          <button type="button" class="min-w-20 rounded-lg border border-border-weak-base px-3 py-2 text-11-semibold text-text-base hover:bg-background-base disabled:opacity-40" disabled={ended()} onClick={() => advance("wait")}>Wait</button>
        </div>
      </div>

      <div class="flex flex-col gap-1.5">
        <div class="flex items-center justify-between gap-2">
          <label for={`platformer-frames-${uid}`} class="text-10-medium text-text-weak">Frames per press</label>
          <span class="font-mono text-10-medium tabular-nums text-text-base">{frames()}</span>
        </div>
        <input
          id={`platformer-frames-${uid}`}
          type="range"
          min="2"
          max="12"
          step="1"
          value={frames()}
          onInput={(event) => setFrames(Number(event.currentTarget.value))}
          class="w-full accent-current"
          disabled={ended()}
        />
        <div class="text-9-regular leading-relaxed text-text-weak">Higher values move farther per press. Lower values give you more precise landings.</div>
      </div>

      <div class="flex flex-wrap items-center justify-between gap-2 border-t border-border-weak-base pt-3">
        <div class="min-w-0 flex-1 text-10-regular leading-relaxed text-text-weak">
          Collect the crystals, avoid hazards, activate checkpoints, and reach the flag.
        </div>
        <button type="button" class="shrink-0 rounded-lg border border-border-weak-base px-3 py-2 text-10-semibold text-text-base hover:bg-background-base" onClick={restart}>
          Restart level
        </button>
      </div>
    </section>
  )
}
