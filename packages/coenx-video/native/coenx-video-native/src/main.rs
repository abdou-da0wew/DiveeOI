mod render;
use serde::{Deserialize, Serialize};
use std::io::{self, BufRead};

#[derive(Clone, Deserialize)]
struct Body {
    #[serde(rename = "nodeId")]
    node_id: String,
    mass: f64,
    #[serde(default)]
    position: [f64; 2],
    velocity: [f64; 2],
    size: [f64; 2],
    #[serde(default = "default_collider")]
    collider: String,
    #[serde(default = "default_restitution")]
    restitution: f64,
    #[serde(rename = "isStatic", default)]
    is_static: bool,
}

#[derive(Clone, Serialize)]
struct Pose {
    #[serde(rename = "nodeId")]
    node_id: String,
    x: f64,
    y: f64,
    #[serde(rename = "velocityX")]
    velocity_x: f64,
    #[serde(rename = "velocityY")]
    velocity_y: f64,
}

#[derive(Serialize)]
struct Frame {
    frame: usize,
    bodies: Vec<Pose>,
}

#[derive(Clone, Deserialize)]
struct Request {
    op: String,
    steps: usize,
    dt: f64,
    gravity: [f64; 2],
    bodies: Vec<Body>,
}

fn default_collider() -> String {
    "aabb".to_owned()
}
fn default_restitution() -> f64 {
    0.2
}
fn inverse_mass(body: &Body) -> f64 {
    if body.is_static || body.mass <= 0.0 {
        0.0
    } else {
        1.0 / body.mass
    }
}

fn overlap(a: &Body, b: &Body, pa: [f64; 2], pb: [f64; 2]) -> Option<(f64, f64, f64)> {
    if a.collider == "circle" && b.collider == "circle" {
        let dx = pb[0] - pa[0];
        let dy = pb[1] - pa[1];
        let distance = (dx * dx + dy * dy).sqrt();
        let radius = a.size[0].min(a.size[1]) / 2.0 + b.size[0].min(b.size[1]) / 2.0;
        if distance >= radius {
            return None;
        }
        let length = distance.max(0.0001);
        return Some((dx / length, dy / length, radius - distance));
    }
    let dx = pb[0] - pa[0];
    let dy = pb[1] - pa[1];
    let ox = (a.size[0] + b.size[0]) / 2.0 - dx.abs();
    let oy = (a.size[1] + b.size[1]) / 2.0 - dy.abs();
    if ox <= 0.0 || oy <= 0.0 {
        return None;
    }
    if ox < oy {
        Some((if dx >= 0.0 { 1.0 } else { -1.0 }, 0.0, ox))
    } else {
        Some((0.0, if dy >= 0.0 { 1.0 } else { -1.0 }, oy))
    }
}

fn solve(request: Request) -> Result<Vec<Frame>, String> {
    if request.op != "simulate" {
        return Err("unsupported native operation".into());
    }
    if request.steps > 36_000 || request.bodies.len() > 500 {
        return Err("physics workload exceeds native limits".into());
    }
    if !request.dt.is_finite() || request.dt <= 0.0 || request.dt > 0.25 {
        return Err("invalid physics time step".into());
    }
    let bodies = request.bodies;
    let mut positions: Vec<[f64; 2]> = bodies.iter().map(|body| body.position).collect();
    let mut velocities: Vec<[f64; 2]> = bodies.iter().map(|body| body.velocity).collect();
    let mut frames = Vec::with_capacity(request.steps + 1);

    for frame in 0..=request.steps {
        frames.push(Frame {
            frame,
            bodies: bodies
                .iter()
                .enumerate()
                .map(|(index, body)| Pose {
                    node_id: body.node_id.clone(),
                    x: positions[index][0],
                    y: positions[index][1],
                    velocity_x: velocities[index][0],
                    velocity_y: velocities[index][1],
                })
                .collect(),
        });
        if frame == request.steps {
            break;
        }
        for index in 0..bodies.len() {
            if bodies[index].is_static {
                continue;
            }
            velocities[index][0] += request.gravity[0] * request.dt;
            velocities[index][1] += request.gravity[1] * request.dt;
            positions[index][0] += velocities[index][0] * request.dt;
            positions[index][1] += velocities[index][1] * request.dt;
        }
        for left in 0..bodies.len() {
            for right in (left + 1)..bodies.len() {
                let Some((nx, ny, depth)) = overlap(
                    &bodies[left],
                    &bodies[right],
                    positions[left],
                    positions[right],
                ) else {
                    continue;
                };
                let inv_a = inverse_mass(&bodies[left]);
                let inv_b = inverse_mass(&bodies[right]);
                let total = inv_a + inv_b;
                if total == 0.0 {
                    continue;
                }
                let correction = (depth - 0.001).max(0.0) / total;
                positions[left][0] -= nx * correction * inv_a;
                positions[left][1] -= ny * correction * inv_a;
                positions[right][0] += nx * correction * inv_b;
                positions[right][1] += ny * correction * inv_b;
                let relative = (velocities[right][0] - velocities[left][0]) * nx
                    + (velocities[right][1] - velocities[left][1]) * ny;
                if relative >= 0.0 {
                    continue;
                }
                let restitution = bodies[left]
                    .restitution
                    .min(bodies[right].restitution)
                    .clamp(0.0, 1.0);
                let impulse = (-(1.0 + restitution) * relative) / total;
                velocities[left][0] -= impulse * inv_a * nx;
                velocities[left][1] -= impulse * inv_a * ny;
                velocities[right][0] += impulse * inv_b * nx;
                velocities[right][1] += impulse * inv_b * ny;
            }
        }
    }
    Ok(frames)
}

fn main() {
    let stdin = io::stdin();
    for line in stdin.lock().lines() {
        let line = match line {
            Ok(value) => value,
            Err(_) => break,
        };
        if line.trim().is_empty() {
            continue;
        }
        let response = std::panic::catch_unwind(|| {
            let value = serde_json::from_str::<serde_json::Value>(&line)
                .map_err(|error| error.to_string())?;
            match value.get("op").and_then(serde_json::Value::as_str) {
                Some("render_frame") => render::render_frame(&value),
                Some("simulate") => serde_json::from_value::<Request>(value)
                    .map_err(|error| error.to_string())
                    .and_then(solve)
                    .map(|frames| serde_json::json!({ "frames": frames })),
                _ => Err("unsupported native operation".into()),
            }
        });
        match response {
            Ok(Ok(result)) => println!("{}", result),
            Ok(Err(error)) => println!("{}", serde_json::json!({ "error": error })),
            Err(_) => println!(
                "{}",
                serde_json::json!({ "error": "native physics panic was contained" })
            ),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn body(id: &str, x: f64, velocity: [f64; 2], is_static: bool) -> Body {
        Body {
            node_id: id.to_owned(),
            mass: 1.0,
            position: [x, 0.0],
            velocity,
            size: [10.0, 10.0],
            collider: "aabb".to_owned(),
            restitution: 0.0,
            is_static,
        }
    }

    #[test]
    fn gravity_advances_dynamic_body_but_not_static_body() {
        let request = Request {
            op: "simulate".to_owned(),
            steps: 2,
            dt: 0.1,
            gravity: [0.0, 10.0],
            bodies: vec![
                body("dynamic", 0.0, [0.0, 0.0], false),
                body("fixed", 20.0, [0.0, 0.0], true),
            ],
        };
        let frames = solve(request).expect("simulation succeeds");
        assert_eq!(frames.len(), 3);
        assert_eq!(frames[0].bodies[0].y, 0.0);
        assert!(frames[2].bodies[0].y > 0.0);
        assert_eq!(frames[2].bodies[1].y, 0.0);
    }

    #[test]
    fn overlapping_bodies_are_separated() {
        let request = Request {
            op: "simulate".to_owned(),
            steps: 1,
            dt: 0.01,
            gravity: [0.0, 0.0],
            bodies: vec![
                body("left", 0.0, [0.0, 0.0], false),
                body("right", 5.0, [0.0, 0.0], false),
            ],
        };
        let frames = solve(request).expect("simulation succeeds");
        let left = frames[1].bodies[0].x;
        let right = frames[1].bodies[1].x;
        assert!(right - left >= 9.99);
    }

    #[test]
    fn rejects_excessive_workloads_and_invalid_time_steps() {
        let mut request = Request {
            op: "simulate".to_owned(),
            steps: 36_001,
            dt: 0.01,
            gravity: [0.0, 0.0],
            bodies: vec![],
        };
        assert!(solve(request.clone()).is_err());
        request.steps = 1;
        request.dt = 0.0;
        assert!(solve(request).is_err());
    }
}
