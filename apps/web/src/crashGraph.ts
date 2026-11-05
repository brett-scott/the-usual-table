/** Continuously expanding camera; no range switches at whole multipliers or ten-second boundaries. */
export function crashGraphCamera(multiplier:number,elapsedSeconds:number){
  return{maxTime:Math.hypot(10,Math.max(0,elapsedSeconds)*1.22),maxValue:1+Math.hypot(1,Math.max(0,multiplier-1)*1.22)};
}
export function crashGraphGeometry(multiplier:number,elapsedSeconds:number,width:number,height:number){
  const value=Math.max(1,multiplier);const elapsed=Math.max(0,elapsedSeconds);const {maxTime,maxValue}=crashGraphCamera(value,elapsed);
  const left=44;const right=Math.max(left+1,width-19);const top=height<90?10:19;const bottom=Math.max(top+1,height-(height<90?18:25));
  const x=(seconds:number)=>left+seconds/maxTime*(right-left);
  const y=(amount:number)=>bottom-(amount-1)/(maxValue-1)*(bottom-top);
  const logarithm=Math.log(value);const segments=8;const steps:string[]=[`M ${left.toFixed(3)} ${bottom.toFixed(3)}`];
  // Cubic Hermite segments share the exact exponential tangent, producing a continuously curved path.
  const tangent=(fraction:number)=>-logarithm*Math.exp(logarithm*fraction)*(bottom-top)/(maxValue-1);
  for(let i=0;i<segments;i++){
    const a=i/segments;const b=(i+1)/segments;const x0=x(elapsed*a);const x1=x(elapsed*b);const y0=y(Math.exp(logarithm*a));const y1=y(Math.exp(logarithm*b));const dx=(x1-x0)/3;
    steps.push(`C ${(x0+dx).toFixed(3)} ${(y0+tangent(a)/segments/3).toFixed(3)} ${(x1-dx).toFixed(3)} ${(y1-tangent(b)/segments/3).toFixed(3)} ${x1.toFixed(3)} ${y1.toFixed(3)}`);
  }
  const endpoint={x:x(elapsed),y:y(value)};
  const slope=elapsed>0?value*logarithm/elapsed*((bottom-top)/(maxValue-1))/((right-left)/maxTime):0;
  return{maxTime,maxValue,left,right,top,bottom,x,y,line:steps.join(' '),endpoint,angle:-Math.atan(slope)*180/Math.PI};
}
