import { TripzyProxyController } from './tripzy-proxy.controller';
import { Module } from '@nestjs/common';

/** Tripzy Intelligence bridge: authenticated proxy to the planning engine. */
@Module({ controllers: [TripzyProxyController] })
export class TripzyModule {}
