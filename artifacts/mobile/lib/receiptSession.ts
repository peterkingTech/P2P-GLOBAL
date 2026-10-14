import { supabase } from "@/contexts/AuthContext";
import { createDeliveryAcker } from "@/lib/messageReceiptsApi";

// One delivery acknowledger for the whole app session, shared by the inbox
// (DataContext) and open conversations, so a message is acknowledged as
// delivered once no matter where this device first received it.
export const deliveryAcker = createDeliveryAcker(() => supabase);
