import {cert, initializeApp} from "firebase-admin"
import serviceAccount from "../serviceaccount.json" with{type:"json"}
export const app = initializeApp({
    credential:cert
})