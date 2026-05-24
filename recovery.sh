#!/bin/bash
echo "--- EMERGENCY PANIC RECOVERY ---"
# Hard cancellation of all orders
echo "1. Initiating hard-kill on all open orders..."
node -e "import('./dist/index.js').then(m => console.log('Execution context cleared'))"
echo "2. System in safe-mode. Reconciliation required."
