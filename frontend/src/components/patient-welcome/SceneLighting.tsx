export function SceneLighting() {
  return (
    <>
      <hemisphereLight args={['#4a3f5c', '#0b0912', 0.7]} />
      {/* Key — warm rose-gold, echoes the wordmark */}
      <pointLight position={[2.4, 2.5, 3.2]} intensity={2.8} color="#f3c9bd" distance={14} decay={2} />
      {/* Fill — cool cyan, keeps shadows from going muddy */}
      <pointLight position={[-3, -1.2, 2.4]} intensity={1.3} color="#7dd3f0" distance={14} decay={2} />
      {/* Rim — violet, separates objects from the dark backdrop */}
      <pointLight position={[0, 1.4, -3.4]} intensity={1.7} color="#a78bfa" distance={14} decay={2} />
      {/* Camera-side headlight — keeps whichever face the viewer sees from going
          fully dark as objects orbit through the rig, regardless of angle. */}
      <pointLight position={[0, 0.4, 5.6]} intensity={1.5} color="#fff4ee" distance={14} decay={2} />
    </>
  )
}
