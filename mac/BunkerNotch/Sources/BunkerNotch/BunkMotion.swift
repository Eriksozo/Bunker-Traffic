import CoreGraphics
import Foundation

/// Procedural life for Bunk, pure and deterministic (same time → same pose), testable in `--self-test`.
/// Techniques from the animation principles summarised in rossark0/rossark-motion-skill (MIT): irregular blinks,
/// micro-saccades, secondary motion (spring antenna), squash and stretch keeping volume, throw with inertia, and
/// an arc tumble when falling (ideas only from MacPenguins and the Shimeji family, GPL; rewritten here).
enum BunkMotion {
    /// Stable pseudo-random 0…1 for an integer seed (no global RNG: the drawing must not flicker between frames).
    static func noise(_ n: Int) -> Double {
        var x = UInt64(bitPattern: Int64(n)) &+ 0x9E3779B97F4A7C15
        x = (x ^ (x >> 30)) &* 0xBF58476D1CE4E5B9; x = (x ^ (x >> 27)) &* 0x94D049BB133111EB; x ^= x >> 31
        return Double(x % 10_000) / 10_000
    }

    /// Eyelid closure 0 (open) … 1 (closed). Blinks every 2.4–6.4 s, sometimes twice; close fast, open slower.
    static func blink(_ t: Double) -> CGFloat {
        let slot = 4.4, i = Int(floor(t / slot)), local = t - Double(i) * slot
        let at = 0.3 + noise(i) * (slot - 1.0)            // when this slot's blink starts
        func lid(_ d: Double) -> CGFloat {                  // one blink: 0.06 s down, 0.11 s up
            if d < 0 || d > 0.17 { return 0 }
            return CGFloat(d < 0.06 ? d / 0.06 : 1 - (d - 0.06) / 0.11)
        }
        let double = noise(i &+ 7_777) < 0.22
        return max(lid(local - at), double ? lid(local - at - 0.26) : 0)
    }

    /// Small eye jumps held for 0.35–1.1 s, like a living gaze (in units of the drawing grid).
    static func saccade(_ t: Double) -> CGPoint {
        var start = 0.0, i = 0
        // Walk the irregular schedule from a recent anchor so cost stays constant.
        let anchor = floor(t / 30) * 30; start = anchor; i = Int(anchor)
        while true {
            let hold = 0.35 + noise(i) * 0.75
            if start + hold > t { break }
            start += hold; i += 1
        }
        return CGPoint(x: (noise(i &* 3) - 0.5) * 0.7, y: (noise(i &* 5 &+ 1) - 0.5) * 0.4)
    }

    /// Antenna bend (−1…1): lags the body's vertical speed and sways a little while walking (secondary motion).
    static func antennaBend(_ t: Double, hopSpeed: Double, hopRate: Double, walking: Bool) -> CGFloat {
        let lag = hopSpeed > 0 ? -sin(t * hopRate - 0.9) * min(1, hopSpeed) : 0
        let sway = walking ? sin(t * 7) * 0.35 : sin(t * 1.3) * 0.08
        return CGFloat(max(-1, min(1, lag * 0.6 + sway)))
    }

    /// Squash and stretch for a hop phase |sin| (0 = touching the ground, 1 = top): squash on contact, stretch rising.
    /// Volume is kept: x = 1 / y.
    static func squashStretch(_ height: Double, strength: Double) -> (x: CGFloat, y: CGFloat) {
        guard strength > 0 else { return (1, 1) }
        let contact = max(0, 0.18 - height) / 0.18          // only near the ground
        let rising = height > 0.18 && height < 0.7 ? 0.04 : 0
        let y = 1 - 0.12 * contact * strength + rising * strength
        return (CGFloat(1 / y), CGFloat(y))
    }

    /// Release speed of a drag from its recent samples (pt/s), capped so a flick never sends him off the planet.
    static func throwVelocity(_ samples: [(p: CGPoint, t: Double)], cap: CGFloat = 2400) -> CGVector {
        guard let last = samples.last, let first = samples.first(where: { last.t - $0.t <= 0.12 }), last.t > first.t else { return .zero }
        let dt = CGFloat(last.t - first.t)
        var v = CGVector(dx: (last.p.x - first.p.x) / dt, dy: (last.p.y - first.p.y) / dt)
        let speed = (v.dx * v.dx + v.dy * v.dy).squareRoot()
        if speed > cap { v = CGVector(dx: v.dx / speed * cap, dy: v.dy / speed * cap) }
        return v
    }

    struct Flight: Equatable { var p: CGPoint; var v: CGVector }
    /// One frame of a thrown flight: gravity, air drag, soft bounce on the side walls; `landed` when he reaches the floor surface.
    static func fly(_ f: Flight, floorY: CGFloat, minX: CGFloat, maxX: CGFloat, dt: CGFloat, gravity: CGFloat = 2600) -> (flight: Flight, landed: Bool, bounced: Bool) {
        var n = f
        n.v.dy -= gravity * dt
        n.v.dx *= pow(0.6, dt)                               // air drag
        n.p.x += n.v.dx * dt; n.p.y += n.v.dy * dt
        var bounced = false
        if n.p.x < minX { n.p.x = minX; n.v.dx = -n.v.dx * 0.45; bounced = true }
        if n.p.x > maxX { n.p.x = maxX; n.v.dx = -n.v.dx * 0.45; bounced = true }
        if n.p.y <= floorY && n.v.dy <= 0 { n.p.y = floorY; return (n, true, bounced) }
        return (n, false, bounced)
    }

    /// Tilt (degrees) while airborne: leans into the horizontal speed, tumbles a little more when falling fast.
    static func tilt(vx: CGFloat, vy: CGFloat) -> Double {
        let lean = Double(max(-1, min(1, vx / 1600))) * 22
        let tumble = vy < -600 ? Double(max(-1, min(1, vx / 900))) * 12 : 0
        return max(-35, min(35, lean + tumble))
    }
}
