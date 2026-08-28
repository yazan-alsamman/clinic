/**
 * A restrained architectural shell — polished floor, a backlit feature wall the
 * logo sits against, a ceiling light cove, and two slim pillars for depth — just
 * enough for the composition to read as "inside a room," not a literal building.
 */
export function ClinicEnvironment({ lowPower }: { lowPower: boolean }) {
  return (
    <group>
      {/* Floor — polished dark stone with a soft light pool under the logo */}
      <mesh position={[0, -1.35, -0.5]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow={false}>
        <planeGeometry args={[14, 10]} />
        <meshStandardMaterial color="#0c0c14" roughness={0.62} metalness={0.05} />
      </mesh>
      <mesh position={[0, -1.34, -0.3]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[2.6, lowPower ? 24 : 48]} />
        <meshBasicMaterial color="#e9b2a8" transparent opacity={0.05} />
      </mesh>

      {/* Feature wall behind the logo — the "architectural signage" surface */}
      <mesh position={[0, 0.8, -3.6]}>
        <planeGeometry args={[9, 5]} />
        <meshPhysicalMaterial color="#111119" roughness={0.55} metalness={0.05} />
      </mesh>
      <mesh position={[0, 0.15, -3.55]}>
        <planeGeometry args={[3.1, 1.55]} />
        <meshBasicMaterial color="#f0c6b8" transparent opacity={0.06} />
      </mesh>

      {/* Ceiling light cove — soft overhead architectural illumination */}
      <mesh position={[0, 2.45, -1.2]}>
        <boxGeometry args={[6.4, 0.05, 0.14]} />
        <meshStandardMaterial color="#fff6ee" emissive="#fff1e2" emissiveIntensity={1.1} roughness={0.5} />
      </mesh>

      {/* Slim pillars for lateral depth — silhouettes only, never the focus.
          Matte (not glossy): a glossy thin cylinder this close to the point
          lights blows out into a hard specular streak instead of a soft form. */}
      {[-4.4, 4.4].map((x) => (
        <mesh key={x} position={[x, 0.2, -2.4]}>
          <cylinderGeometry args={[0.09, 0.11, 3.6, lowPower ? 8 : 16]} />
          <meshStandardMaterial color="#15151a" roughness={0.92} metalness={0} />
        </mesh>
      ))}
    </group>
  )
}
