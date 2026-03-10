// Quick test: hit the streaming endpoint and print results
async function test() {
  console.log("Sending test message...");
  
  try {
    const res = await fetch("http://localhost:3000/api/chat/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "hi", sessionId: "test-node-1" }),
    });
    
    console.log("Status:", res.status);
    
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      console.log("CHUNK:", decoder.decode(value));
    }
    
    console.log("Stream ended");
  } catch (err) {
    console.error("Error:", err.message);
  }
}

test();
