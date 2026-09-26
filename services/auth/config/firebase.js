import {cert, initializeApp} from "firebase-admin/app"
import serviceAccount from "../serviceaccount.json" with{type:"json"}
export const app = initializeApp({
    credential:cert(serviceAccount)
})