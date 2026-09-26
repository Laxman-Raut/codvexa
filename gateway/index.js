import express from 'express';
import { configDotenv } from 'dotenv';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import morgan from 'morgan';
import proxy from 'express-http-proxy';

configDotenv();

const port = process.env.PORT || 8000;
const AUTH_SERVICE = process.env.AUTH_SERVICE;

if (!AUTH_SERVICE) {
    console.error('AUTH_SERVICE is not set in .env');
    process.exit(1);
}

const app = express();

app.use(cors({
    origin: process.env.FRONTEND_URL,
    credentials: true
}));
app.use(cookieParser());
app.use(morgan('dev'));
app.use(express.json());

app.get("/", (req, res) => {
    res.json({ message: "service is up" });
});


app.use('/api/auth', proxy(AUTH_SERVICE, {
    // /auth/login -> /login on the auth service
    proxyReqPathResolver: (req) => req.url.replace(/^\/api\/auth/, '') || '/',


    proxyErrorHandler: (err, res, next) => {
        console.error('Auth proxy error:', err.code, err.message);
        res.status(502).json({ message: 'Auth service unreachable', error: err.code });
    }
}));



app.get('/health', (req, res) => {
    res.status(200).json({ message: 'ya gateway is running' });
});

app.listen(port, () => {
    console.log(`http://localhost:${port}`);
 
});